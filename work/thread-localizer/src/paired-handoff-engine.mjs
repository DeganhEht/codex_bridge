import { createAppServerClient } from "./appserver-client.mjs";
import { appServerProviderOverrides, normalizeCwd } from "./provider-config.mjs";
import {
  clearThreadBoundEncryptedReasoning,
  normalizeOpenAIRolloutRecords,
} from "./openai-rollout-normalizer.mjs";
import {
  appendProjectionEvents,
  rolloutState,
  stateRow,
} from "./handoff-engine.mjs";
import { readFlattenedRollout } from "./rollout-reader.mjs";
import {
  findContiguousBlockOccurrences,
  recordsFingerprint,
  repeatedTailInfo,
} from "./pair-sync-signatures.mjs";
import { countVisibleMessages, nowIso } from "./utils.mjs";
import { verifyThread } from "./verify-mirror.mjs";

function retargetDelta(records, { sourceThreadId, targetThreadId }) {
  return records.map((record) => {
    const value = structuredClone(record.value);
    if (value?.type === "event_msg" && typeof value.payload?.thread_id === "string") {
      value.payload.thread_id = targetThreadId;
    }
    return { ...record, value };
  });
}

export function normalizedPairDelta(records, targetProvider) {
  const detached = clearThreadBoundEncryptedReasoning(records);
  const normalized = normalizeOpenAIRolloutRecords(detached.records, { targetProvider });
  return {
    ...normalized,
    clearedEncryptedReasoningCount: detached.clearedEncryptedReasoningCount,
  };
}

function pairTargetError(reason, message) {
  const error = new Error(message);
  error.handoffReason = reason;
  return error;
}

async function rethrowWithPartialSyncGuard(error, {
  mutationAttempted,
  targetThreadId,
  targetBeforeRollout,
}) {
  if (!mutationAttempted || !targetBeforeRollout) throw error;
  try {
    const targetAfterFailure = await rolloutState(targetThreadId);
    if (targetAfterFailure.flattenedRecordCount !== targetBeforeRollout.flattenedRecordCount) {
      const partial = new Error(
        `配对同步部分写入，目标 rollout 记录数从 ${targetBeforeRollout.flattenedRecordCount} `
        + `变为 ${targetAfterFailure.flattenedRecordCount}；已阻止自动重试。原错误：${error.message}`,
      );
      partial.handoffReason = "partial-sync";
      throw partial;
    }
  } catch (inspectionError) {
    if (inspectionError.handoffReason === "partial-sync") throw inspectionError;
    const uncertain = new Error(`配对同步写入状态无法确认，已阻止自动重试。原错误：${error.message}`);
    uncertain.handoffReason = "partial-sync-unknown";
    throw uncertain;
  }
  throw error;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pairResumeParams({
  targetThreadId,
  sourceCwd,
  targetProvider,
  targetModel,
  targetReasoningEffort,
}) {
  const params = {
    threadId: targetThreadId,
    cwd: sourceCwd,
    modelProvider: targetProvider,
    model: targetModel,
    excludeTurns: false,
  };
  if (targetReasoningEffort) params.config = { model_reasoning_effort: targetReasoningEffort };
  return params;
}

export async function resumeAndWaitForPairTarget({
  client,
  targetThreadId,
  resumeParams,
  timeoutMs = 10_000,
  pollIntervalMs = 100,
  sleep = wait,
}) {
  try {
    await client.request("thread/resume", resumeParams);
  } catch (error) {
    throw pairTargetError(
      "paired-target-resume-failed",
      `配对目标 ${targetThreadId} resume 失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let loaded;
    try {
      const result = await client.request("thread/loaded/list", {});
      loaded = Array.isArray(result?.data) && result.data.includes(targetThreadId);
    } catch (error) {
      throw pairTargetError(
        "paired-target-resume-failed",
        `配对目标 ${targetThreadId} 的 loaded 状态检查失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (loaded) return { threadId: targetThreadId, loaded: true };
    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  }

  throw pairTargetError(
    "paired-target-load-timeout",
    `配对目标 ${targetThreadId} 已 resume，但在 ${timeoutMs}ms 内未进入 loaded 状态`,
  );
}

export async function probeExistingPairTarget({
  targetThreadId,
  targetProvider,
  targetModel,
  targetReasoningEffort,
  cwd,
}) {
  const client = await createAppServerClient({
    cwd: normalizeCwd(cwd) || process.cwd(),
    configOverrides: appServerProviderOverrides(targetProvider, targetModel, targetReasoningEffort),
  });
  try {
    const verification = await verifyThread(client, targetThreadId);
    return {
      method: "thread-read-stored",
      verification,
    };
  } finally {
    await client.close();
  }
}

export async function syncExistingPair({
  task,
  sourceThreadId,
  sourceProvider,
  targetProvider,
  targetThreadId,
  targetModel,
  targetReasoningEffort,
  onPendingSync = null,
}) {
  if (!targetThreadId) throw new Error(`任务 ${task.stableTaskId} 没有 ${targetProvider} 配对任务`);
  const cursor = task.pairSync?.[sourceProvider];
  if (!cursor || cursor.threadId !== sourceThreadId) {
    throw new Error(`任务 ${task.stableTaskId} 缺少 ${sourceProvider} 配对同步游标`);
  }
  const sourceDatabase = stateRow(sourceThreadId);
  const sourceCwd = normalizeCwd(sourceDatabase?.cwd) || process.cwd();
  const sourceRollout = await rolloutState(sourceThreadId);
  const sourceFlattened = await readFlattenedRollout(sourceRollout.rolloutPath);
  if (sourceFlattened.errors.length > 0) {
    throw new Error(`配对源任务 ${sourceThreadId} 的 rollout 历史存在解析错误`);
  }
  if (cursor.recordCount > sourceFlattened.records.length) {
    throw new Error(`配对源任务 ${sourceThreadId} 的同步游标超过当前历史长度`);
  }

  const pending = task.pendingSync
    && task.pendingSync.sourceThreadId === sourceThreadId
    && task.pendingSync.targetThreadId === targetThreadId
    ? task.pendingSync
    : null;
  const sourceRecordEnd = pending?.sourceRecordEnd ?? sourceFlattened.records.length;
  if (sourceRecordEnd > sourceFlattened.records.length || sourceRecordEnd < cursor.recordCount) {
    throw new Error(`任务 ${task.stableTaskId} 的 pendingSync 源历史边界无效`);
  }
  const delta = sourceFlattened.records.slice(cursor.recordCount, sourceRecordEnd);
  if (delta.length === 0) {
    const targetDatabase = stateRow(targetThreadId);
    const entry = {
      sourceThreadId,
      sourceProvider,
      sourceModel: sourceDatabase?.model || null,
      sourceRolloutPath: sourceRollout.rolloutPath,
      targetThreadId,
      targetProvider,
      targetModel,
      targetReasoningEffort: targetDatabase?.reasoning_effort || targetReasoningEffort || null,
      targetName: task.explicitName || task.displayName,
      cwd: sourceCwd,
      handedOffAt: nowIso(),
      backupRoot: null,
      checks: {
        provider: targetDatabase?.model_provider === targetProvider,
        model: targetModel ? targetDatabase?.model === targetModel : true,
        independentHistory: true,
      },
      historyTransfer: {
        strategy: "persistent-pair-delta",
        sourceRecordCount: sourceRecordEnd,
        targetRecordCount: task.pairSync?.[targetProvider]?.recordCount || null,
        sourceReference: null,
      },
      pinning: { requested: false, supported: false, applied: false, status: "not-requested" },
      normalization: {
        applied: false,
        normalizedReasoningCount: 0,
        clearedEncryptedReasoningCount: 0,
        normalizedWebSearchCallIdCount: 0,
        normalizedWebSearchEventReferenceCount: 0,
        droppedOrphanToolOutputCount: 0,
        droppedOrphanToolOutputs: [],
        targetRolloutSha256After: null,
        backupPath: null,
      },
      providerCompat: {
        targetProvider,
        droppedOrphanToolOutputCount: 0,
        droppedOrphanToolOutputs: [],
      },
    };
    return {
      type: "paired-noop",
      stableTaskId: task.stableTaskId,
      sourceThreadId,
      targetThreadId,
      sourceRecordCount: sourceRecordEnd,
      targetRecordCount: task.pairSync?.[targetProvider]?.recordCount || null,
      entry,
    };
  }

  const retargeted = retargetDelta(delta, { sourceThreadId, targetThreadId });
  const normalized = normalizedPairDelta(retargeted, targetProvider);
  const responseItemsToInject = normalized.records
    .filter((record) => record.value?.type === "response_item" && record.value?.payload)
    .map((record) => record.value.payload);
  const projectionEvents = normalized.records.filter((record) => (
    record.value?.type === "event_msg"
    && ["task_started", "item_completed", "task_complete", "turn_aborted"].includes(record.value?.payload?.type)
  ));
  if (responseItemsToInject.length === 0) {
    // 源增量里只有非正文记录（例如上一次同步之后才落盘的 task_complete、设置或
    // 上下文事件）。没有可注入的 Responses 历史项时不能调用 thread/inject_items，
    // 但投影事件里可能仍然嵌着消息内容：那种情况必须照常镜像到目标，只有纯记账
    // 事件才允许跳过。
    const contentBearingProjections = projectionEvents.filter((record) => {
      const item = record.value?.payload?.item;
      if (!item || typeof item !== "object") return false;
      if (["userMessage", "agentMessage", "UserMessage", "AgentMessage"].includes(item.type)) return true;
      if (item.type === "message" && ["user", "assistant"].includes(item.role)) return true;
      return false;
    });
    if (contentBearingProjections.length > 0) {
      const targetPathForProjection = stateRow(targetThreadId)?.rollout_path;
      if (!targetPathForProjection) throw new Error(`找不到配对目标任务 ${targetThreadId} 的 rollout`);
      const appended = await appendProjectionEvents(targetPathForProjection, projectionEvents);
      const targetRolloutAfterProjection = await rolloutState(targetThreadId);
      const targetDatabase = stateRow(targetThreadId);
      const droppedOrphanToolOutputs = normalized.droppedOrphanToolOutputs || [];
      const entry = {
        sourceThreadId,
        sourceProvider,
        sourceModel: sourceDatabase?.model || null,
        sourceRolloutPath: sourceRollout.rolloutPath,
        targetThreadId,
        targetProvider,
        targetModel,
        targetReasoningEffort: targetDatabase?.reasoning_effort || targetReasoningEffort || null,
        targetName: task.explicitName || task.displayName,
        cwd: sourceCwd,
        handedOffAt: nowIso(),
        backupRoot: null,
        checks: {
          provider: targetDatabase?.model_provider === targetProvider,
          model: targetModel ? targetDatabase?.model === targetModel : true,
          independentHistory: true,
          projectionOnly: true,
        },
        historyTransfer: {
          strategy: "persistent-pair-projection-only",
          sourceRecordCount: sourceRecordEnd,
          targetRecordCount: targetRolloutAfterProjection.flattenedRecordCount,
          sourceReference: null,
        },
        pinning: { requested: false, supported: false, applied: false, status: "not-requested" },
        normalization: {
          applied: droppedOrphanToolOutputs.length > 0,
          normalizedReasoningCount: normalized.normalizedReasoningCount || 0,
          clearedEncryptedReasoningCount: normalized.clearedEncryptedReasoningCount || 0,
          normalizedWebSearchCallIdCount: normalized.normalizedWebSearchCallIdCount || 0,
          normalizedWebSearchEventReferenceCount: normalized.normalizedWebSearchEventReferenceCount || 0,
          droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
          droppedOrphanToolOutputs,
          targetRolloutSha256After: null,
          backupPath: null,
        },
        providerCompat: {
          targetProvider,
          droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
          droppedOrphanToolOutputs,
        },
        projectionEventCount: appended.projectionEventCount,
        contentBearingProjectionCount: contentBearingProjections.length,
      };
      return {
        type: "paired-synced",
        stableTaskId: task.stableTaskId,
        sourceThreadId,
        sourceProvider,
        targetThreadId,
        targetProvider,
        targetModel,
        targetReasoningEffort,
        sourceRecordCount: sourceRecordEnd,
        targetRecordCount: targetRolloutAfterProjection.flattenedRecordCount,
        projectionOnly: true,
        reason: "paired-delta-projection-only",
        entry,
        synchronization: {
          strategy: "persistent-pair-projection-only",
          sourceRecordStart: cursor.recordCount,
          sourceRecordEnd,
          responseItemCount: 0,
          projectionEventCount: appended.projectionEventCount,
          contentBearingProjectionCount: contentBearingProjections.length,
          projectionOnly: true,
          synchronizedAt: nowIso(),
        },
      };
    }

    const targetRolloutAfterSkip = await rolloutState(targetThreadId);
    const targetDatabase = stateRow(targetThreadId);
    const droppedOrphanToolOutputs = normalized.droppedOrphanToolOutputs || [];
    const skippedRecords = delta.map((record) => ({
      type: record.value?.type || null,
      payloadType: record.value?.payload?.type || null,
      ordinal: Number.isInteger(record.value?.ordinal) ? record.value.ordinal : null,
    }));
    const entry = {
      sourceThreadId,
      sourceProvider,
      sourceModel: sourceDatabase?.model || null,
      sourceRolloutPath: sourceRollout.rolloutPath,
      targetThreadId,
      targetProvider,
      targetModel,
      targetReasoningEffort: targetDatabase?.reasoning_effort || targetReasoningEffort || null,
      targetName: task.explicitName || task.displayName,
      cwd: sourceCwd,
      handedOffAt: nowIso(),
      backupRoot: null,
      checks: {
        provider: targetDatabase?.model_provider === targetProvider,
        model: targetModel ? targetDatabase?.model === targetModel : true,
        independentHistory: true,
        projectionSkipped: true,
      },
      historyTransfer: {
        strategy: "persistent-pair-delta-projection-skip",
        sourceRecordCount: sourceRecordEnd,
        targetRecordCount: targetRolloutAfterSkip.flattenedRecordCount,
        sourceReference: null,
      },
      pinning: { requested: false, supported: false, applied: false, status: "not-requested" },
      normalization: {
        applied: droppedOrphanToolOutputs.length > 0,
        normalizedReasoningCount: normalized.normalizedReasoningCount || 0,
        clearedEncryptedReasoningCount: normalized.clearedEncryptedReasoningCount || 0,
        normalizedWebSearchCallIdCount: normalized.normalizedWebSearchCallIdCount || 0,
        normalizedWebSearchEventReferenceCount: normalized.normalizedWebSearchEventReferenceCount || 0,
        droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
        droppedOrphanToolOutputs,
        targetRolloutSha256After: null,
        backupPath: null,
      },
      providerCompat: {
        targetProvider,
        droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
        droppedOrphanToolOutputs,
      },
      skippedRecordCount: delta.length,
      skippedProjectionEventCount: projectionEvents.length,
      skippedRecords,
    };
    return {
      type: "paired-noop",
      stableTaskId: task.stableTaskId,
      sourceThreadId,
      sourceProvider,
      targetThreadId,
      targetProvider,
      sourceRecordCount: sourceRecordEnd,
      targetRecordCount: targetRolloutAfterSkip.flattenedRecordCount,
      reason: "paired-delta-without-response-items",
      skippedRecordCount: delta.length,
      skippedProjectionEventCount: projectionEvents.length,
      entry,
    };
  }
  const expectedHistoryBlock = [
    ...normalized.records.filter((record) => record.value?.type === "response_item" && record.value?.payload),
    ...projectionEvents,
  ];
  const expectedHistoryFingerprint = recordsFingerprint(expectedHistoryBlock);

  const clientOptions = {
    cwd: sourceCwd,
    configOverrides: appServerProviderOverrides(targetProvider, targetModel, targetReasoningEffort),
  };
  const targetPath = stateRow(targetThreadId)?.rollout_path;
  if (!targetPath) throw new Error(`找不到配对目标任务 ${targetThreadId} 的 rollout`);
  const targetBeforeRollout = await rolloutState(targetThreadId);
  const targetHistoryBefore = await readFlattenedRollout(targetBeforeRollout.rolloutPath);
  const targetPairCursor = task.pairSync?.[targetProvider];
  if (targetPairCursor && Number.isFinite(Number(targetPairCursor.recordCount))) {
    const duplicate = repeatedTailInfo(targetHistoryBefore.records, Number(targetPairCursor.recordCount));
    if (duplicate && duplicate.copies > 1) {
      const error = pairTargetError(
        "duplicate-delta-detected",
        `目标端点 ${targetThreadId} 在同步游标后检测到 ${duplicate.copies} 份相同历史块（${duplicate.blockRecordCount} 条/份，指纹 ${duplicate.fingerprint}）`,
      );
      throw error;
    }
  }
  const targetRecordStart = Number(targetPairCursor?.recordCount);
  const targetTailBefore = Number.isFinite(targetRecordStart)
    ? targetHistoryBefore.records.slice(targetRecordStart)
    : targetHistoryBefore.records;
  const existingOccurrences = findContiguousBlockOccurrences(targetTailBefore, expectedHistoryBlock);
  if (pending && pending.expectedFingerprint !== expectedHistoryFingerprint) {
    throw pairTargetError(
      "pending-sync-recovery-required",
      `任务 ${task.stableTaskId} 的 pendingSync 指纹与当前源增量不一致，需先完成恢复`,
    );
  }
  if (
    pending
    && existingOccurrences.length === 0
    && Number.isFinite(Number(pending.targetBeforeRecordCount))
    && targetHistoryBefore.records.length !== Number(pending.targetBeforeRecordCount)
  ) {
    throw pairTargetError(
      "pending-sync-recovery-required",
      `任务 ${task.stableTaskId} 的目标已发生写入但预期历史块无法识别，已禁止再次注入`,
    );
  }
  if (existingOccurrences.length > 1) {
    throw pairTargetError(
      "duplicate-delta-detected",
      `目标端点 ${targetThreadId} 在同步游标后检测到 ${existingOccurrences.length} 份相同历史块，已阻止继续写入`,
    );
  }
  let mutationAttempted = false;
  let before;
  let appended;
  let after;
  let reconciled = existingOccurrences.length === 1;
  try {
    if (reconciled) {
      const reconcileClient = await createAppServerClient(clientOptions);
      try {
      const resumeParams = pairResumeParams({
        targetThreadId,
        sourceCwd,
        targetProvider,
        targetModel,
        targetReasoningEffort,
      });
      await resumeAndWaitForPairTarget({
        client: reconcileClient,
        targetThreadId,
        resumeParams,
      });
        before = await verifyThread(reconcileClient, targetThreadId);
        after = before;
      } finally {
        await reconcileClient.close();
      }
      appended = { projectionEventCount: 0 };
    } else {
      if (onPendingSync) {
        await onPendingSync({
          sourceThreadId,
          sourceProvider,
          targetThreadId,
          targetProvider,
          sourceRecordStart: cursor.recordCount,
          sourceRecordEnd,
          targetRecordStart: Number.isFinite(targetRecordStart) ? targetRecordStart : null,
          expectedRecordCount: expectedHistoryBlock.length,
          expectedFingerprint: expectedHistoryFingerprint,
          targetBeforeRecordCount: targetBeforeRollout.flattenedRecordCount,
          targetBeforeSha256: targetBeforeRollout.rolloutSha256,
          pendingAt: nowIso(),
        });
      }

      // thread/read only reads a stored task. Resume it first so the app-server
      // owns a live thread before thread/inject_items is called.
      const injectClient = await createAppServerClient(clientOptions);
      try {
        const resumeParams = pairResumeParams({
          targetThreadId,
          sourceCwd,
          targetProvider,
          targetModel,
          targetReasoningEffort,
        });
        await resumeAndWaitForPairTarget({
          client: injectClient,
          targetThreadId,
          resumeParams,
        });
        before = await verifyThread(injectClient, targetThreadId);
        mutationAttempted = true;
        await injectClient.request("thread/inject_items", {
          threadId: targetThreadId,
          items: responseItemsToInject,
        });
      } finally {
        await injectClient.close();
      }

      appended = await appendProjectionEvents(targetPath, projectionEvents);

      const resumeClient = await createAppServerClient(clientOptions);
      try {
        const resumeParams = pairResumeParams({
          targetThreadId,
          sourceCwd,
          targetProvider,
          targetModel,
          targetReasoningEffort,
        });
        await resumeAndWaitForPairTarget({
          client: resumeClient,
          targetThreadId,
          resumeParams,
        });
        after = await verifyThread(resumeClient, targetThreadId);
      } finally {
        await resumeClient.close();
      }
    }
  } catch (error) {
    await rethrowWithPartialSyncGuard(error, {
      mutationAttempted,
      targetThreadId,
      targetBeforeRollout,
    });
  }

  if (reconciled && sourceFlattened.records.length > sourceRecordEnd) {
    const reconciledTarget = await rolloutState(targetThreadId);
    const nextTask = JSON.parse(JSON.stringify(task));
    nextTask.pairSync = {
      ...(nextTask.pairSync || {}),
      [sourceProvider]: {
        ...(nextTask.pairSync?.[sourceProvider] || {}),
        threadId: sourceThreadId,
        recordCount: sourceRecordEnd,
      },
      [targetProvider]: {
        ...(nextTask.pairSync?.[targetProvider] || {}),
        threadId: targetThreadId,
        recordCount: reconciledTarget.flattenedRecordCount,
      },
    };
    nextTask.pendingSync = null;
    return syncExistingPair({
      task: nextTask,
      sourceThreadId,
      sourceProvider,
      targetProvider,
      targetThreadId,
      targetModel,
      targetReasoningEffort,
      onPendingSync,
    });
  }

  let itemDelta;
  let turnDelta;
  let visibleDelta;
  let checks;
  try {
    itemDelta = projectionEvents.filter((record) => record.value?.payload?.type === "item_completed").length;
    turnDelta = projectionEvents.filter((record) => record.value?.payload?.type === "task_started").length;
    visibleDelta = countVisibleMessages(
      projectionEvents.map((record) => record.value?.payload?.item).filter(Boolean),
    );
    const targetAfterHistory = await readFlattenedRollout(after.rolloutPath);
    const targetPairCursor = Number(task.pairSync?.[targetProvider]?.recordCount);
    const targetTail = Number.isFinite(targetPairCursor)
      ? targetAfterHistory.records.slice(targetPairCursor)
      : targetAfterHistory.records;
    const historyOccurrences = findContiguousBlockOccurrences(targetTail, expectedHistoryBlock);
    if (historyOccurrences.length > 1) {
      throw pairTargetError(
        "duplicate-delta-detected",
        `配对目标 ${targetThreadId} 检测到 ${historyOccurrences.length} 份相同历史块，已阻止提交游标`,
      );
    }
    if (historyOccurrences.length !== 1) {
      throw new Error(
        `配对同步内容指纹验收失败：目标 ${targetThreadId} 找到 ${historyOccurrences.length} 份预期历史块 `
        + `(预期指纹 ${expectedHistoryFingerprint})`,
      );
    }
    checks = {
      provider: stateRow(targetThreadId)?.model_provider === targetProvider,
      model: targetModel ? stateRow(targetThreadId)?.model === targetModel : true,
      historyBlock: true,
      historyFingerprint: expectedHistoryFingerprint,
      turnCount: after.turnCount === before.turnCount + turnDelta,
      itemCount: after.itemCount === before.itemCount + itemDelta,
      visibleMessageCount: after.visibleMessageCount === before.visibleMessageCount + visibleDelta,
      reconciled,
    };
    if (!checks.provider || !checks.model || !checks.historyBlock) {
      throw new Error(`配对同步基础验收失败: ${JSON.stringify(checks)}`);
    }
  } catch (error) {
    await rethrowWithPartialSyncGuard(error, {
      mutationAttempted,
      targetThreadId,
      targetBeforeRollout,
    });
  }

  const targetRollout = await rolloutState(targetThreadId);
  const targetDatabase = stateRow(targetThreadId);
  const droppedOrphanToolOutputs = normalized.droppedOrphanToolOutputs || [];
  const providerCompat = {
    targetProvider,
    droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
    droppedOrphanToolOutputs,
  };
  const entry = {
    sourceThreadId,
    sourceProvider,
    sourceModel: sourceDatabase?.model || null,
    sourceRolloutPath: sourceRollout.rolloutPath,
    targetThreadId,
    targetProvider,
    targetModel,
    targetReasoningEffort: targetDatabase?.reasoning_effort || targetReasoningEffort || null,
    targetName: task.explicitName || task.displayName,
    cwd: sourceCwd,
    handedOffAt: nowIso(),
    backupRoot: null,
    checks: {
      ...checks,
      independentHistory: true,
    },
    historyTransfer: {
      strategy: "persistent-pair-delta",
      sourceRecordCount: sourceRecordEnd,
      targetRecordCount: targetRollout.flattenedRecordCount,
      sourceReference: null,
    },
    pinning: { requested: false, supported: false, applied: false, status: "not-requested" },
    normalization: {
      applied: normalized.totalNormalizedCount > 0
        || normalized.clearedEncryptedReasoningCount > 0
        || droppedOrphanToolOutputs.length > 0,
      normalizedReasoningCount: normalized.normalizedReasoningCount,
      clearedEncryptedReasoningCount: normalized.clearedEncryptedReasoningCount,
      normalizedWebSearchCallIdCount: normalized.normalizedWebSearchCallIdCount,
      normalizedWebSearchEventReferenceCount: normalized.normalizedWebSearchEventReferenceCount,
      droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
      droppedOrphanToolOutputs,
      targetRolloutSha256After: null,
      backupPath: null,
    },
    providerCompat,
  };
  return {
    type: "paired-synced",
    stableTaskId: task.stableTaskId,
    sourceThreadId,
    sourceProvider,
    targetThreadId,
    targetProvider,
    targetModel,
    targetReasoningEffort,
    sourceRecordCount: sourceRecordEnd,
    targetRecordCount: targetRollout.flattenedRecordCount,
    checks,
    entry,
    providerCompat,
    synchronization: {
      strategy: "persistent-pair-delta",
      sourceRecordStart: cursor.recordCount,
      sourceRecordEnd,
      responseItemCount: responseItemsToInject.length,
      projectionEventCount: appended.projectionEventCount,
      reconciled,
      normalizedReasoningCount: normalized.normalizedReasoningCount,
      clearedEncryptedReasoningCount: normalized.clearedEncryptedReasoningCount,
      droppedOrphanToolOutputCount: droppedOrphanToolOutputs.length,
      droppedOrphanToolOutputs,
      synchronizedAt: nowIso(),
    },
  };
}

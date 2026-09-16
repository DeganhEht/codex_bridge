import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createAppServerClient } from "./appserver-client.mjs";
import {
  CODEX_HOME,
  PROJECT_CWD,
  USER_THREAD_SOURCE,
} from "./constants.mjs";
import {
  findRolloutPath,
  readFlattenedRollout,
  retargetFlattenedRollout,
} from "./rollout-reader.mjs";
import { loadAndValidateSchema } from "./schema-guard.mjs";
import { appServerProviderOverrides } from "./provider-config.mjs";
import {
  clearThreadBoundEncryptedReasoning,
  dropOrphanToolOutputs,
  normalizeOpenAIRolloutRecords,
} from "./openai-rollout-normalizer.mjs";
import { nowIso, pathExists, readJsonl, responseThread, sha256File } from "./utils.mjs";
import { verifyThread } from "./verify-mirror.mjs";

export function stateRow(threadId) {
  const db = new DatabaseSync(`${CODEX_HOME}\\state_5.sqlite`, { readOnly: true });
  try {
    return db.prepare(`SELECT id, name, title, preview, model_provider, model, cwd, rollout_path,
      reasoning_effort, thread_source, archived, is_pinned, created_at, updated_at, recency_at
      FROM threads WHERE id = ?`).get(threadId) || null;
  } finally {
    db.close();
  }
}

export async function rolloutState(threadId) {
  const databasePath = stateRow(threadId)?.rollout_path || null;
  const rolloutPath = databasePath && await pathExists(databasePath)
    ? databasePath
    : await findRolloutPath(threadId);
  if (!rolloutPath) throw new Error(`找不到任务 ${threadId} 的 rollout`);
  const parsed = await readFlattenedRollout(rolloutPath);
  let activeTurn = false;
  for (const record of parsed.records) {
    if (record.value?.type === "event_msg") {
      if (record.value.payload?.type === "task_started") activeTurn = true;
      if (["task_complete", "turn_aborted"].includes(record.value.payload?.type)) activeTurn = false;
    }
  }
  const detachedCompatibility = clearThreadBoundEncryptedReasoning(parsed.records);
  const compatibility = normalizeOpenAIRolloutRecords(detachedCompatibility.records);
  const orphanToolOutputs = dropOrphanToolOutputs(parsed.records);
  const flattenedText = `${parsed.records.map((record) => JSON.stringify(record.value)).join("\n")}\n`;
  return {
    rolloutPath,
    rolloutSha256: crypto.createHash("sha256").update(flattenedText).digest("hex"),
    parseErrorCount: parsed.errors.length,
    activeTurn,
    flattenedRecordCount: parsed.records.length,
    segmentCount: parsed.segments.length,
    threadBoundEncryptedReasoningCount: detachedCompatibility.clearedEncryptedReasoningCount,
    reasoningContentArrayCount: compatibility.normalizedReasoningCount,
    invalidWebSearchCallIdCount: compatibility.normalizedWebSearchCallIdCount,
    invalidWebSearchEventReferenceCount: compatibility.normalizedWebSearchEventReferenceCount,
    orphanToolOutputCount: orphanToolOutputs.droppedOrphanToolOutputs.length,
    orphanToolOutputs: orphanToolOutputs.droppedOrphanToolOutputs,
  };
}

function preparedTargetHistory(plan, targetThreadId) {
  return readFlattenedRollout(plan.source.rolloutPath).then((flattened) => {
    if (flattened.errors.length > 0) {
      throw new Error(`无法重建 ${plan.source.threadId}：rollout 历史链存在 ${flattened.errors.length} 个解析错误`);
    }
    const retargeted = retargetFlattenedRollout(flattened.records, {
      sourceThreadId: plan.source.threadId,
      targetThreadId,
      targetProvider: plan.target.provider,
      targetCwd: plan.target.cwd,
      targetThreadSource: plan.target.threadSource,
    });
    const detached = clearThreadBoundEncryptedReasoning(retargeted);
    const normalized = {
      ...normalizeOpenAIRolloutRecords(detached.records, { targetProvider: plan.target.provider }),
      clearedEncryptedReasoningCount: detached.clearedEncryptedReasoningCount,
    };
    const responseItems = normalized.records
      .filter((record) => record.value?.type === "response_item" && record.value?.payload)
      .map((record) => record.value.payload);
    if (responseItems.length === 0) {
      throw new Error("源任务没有可注入的 Responses 历史项，无法安全建立独立目标任务");
    }
    const projectionEvents = normalized.records
      .filter((record) => (
        record.value?.type === "event_msg"
        && ["task_started", "item_completed", "task_complete", "turn_aborted"].includes(record.value?.payload?.type)
      ));
    return { flattened, normalized, responseItems, projectionEvents };
  });
}

export async function appendProjectionEvents(targetRolloutPath, projectionEvents) {
  const originalText = await fs.readFile(targetRolloutPath, "utf8");
  const parsed = await readJsonl(targetRolloutPath);
  if (parsed.errors.length > 0 || parsed.records[0]?.value?.type !== "session_meta") {
    throw new Error("独立目标任务未正确写入 session_meta，停止追加历史事件");
  }
  let nextOrdinal = parsed.records.reduce((maximum, record) => (
    Number.isInteger(record.value?.ordinal) ? Math.max(maximum, record.value.ordinal) : maximum
  ), -1) + 1;
  const values = projectionEvents.map((record) => ({
    ...structuredClone(record.value),
    ordinal: nextOrdinal++,
  }));
  if (values.length > 0) {
    const prefix = originalText.endsWith("\n") || originalText.length === 0 ? "" : "\n";
    await fs.appendFile(
      targetRolloutPath,
      `${prefix}${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
      "utf8",
    );
  }
  return { originalText, projectionEventCount: values.length };
}

export async function buildHandoffPlan({
  sourceThreadId,
  targetProvider,
  targetModel = null,
  targetReasoningEffort = null,
  targetName = null,
  pinTarget = false,
}) {
  if (!sourceThreadId || !targetProvider) throw new Error("handoff 需要源任务和目标提供商");
  const schema = await loadAndValidateSchema();
  const sourceRollout = await rolloutState(sourceThreadId);
  const sourceClient = await createAppServerClient({ cwd: PROJECT_CWD });
  let sourceVerification;
  try {
    sourceVerification = await verifyThread(sourceClient, sourceThreadId);
  } finally {
    await sourceClient.close();
  }
  const sourceDatabase = stateRow(sourceThreadId);
  if (!sourceDatabase) throw new Error(`state_5.sqlite 中找不到源任务 ${sourceThreadId}`);
  const plan = {
    generatedAt: nowIso(),
    source: {
      threadId: sourceThreadId,
      name: sourceVerification.name,
      provider: sourceDatabase.model_provider,
      model: sourceDatabase.model,
      reasoningEffort: sourceDatabase.reasoning_effort || null,
      cwd: sourceVerification.cwd,
      rolloutPath: sourceRollout.rolloutPath,
      rolloutSha256: sourceRollout.rolloutSha256,
      parseErrorCount: sourceRollout.parseErrorCount,
      activeTurn: sourceRollout.activeTurn,
      turnCount: sourceVerification.turnCount,
      itemCount: sourceVerification.itemCount,
      visibleMessageCount: sourceVerification.visibleMessageCount,
      flattenedRecordCount: sourceRollout.flattenedRecordCount,
      segmentCount: sourceRollout.segmentCount,
      isPinned: Boolean(sourceDatabase.is_pinned),
    },
    target: {
      provider: targetProvider,
      model: targetModel,
      reasoningEffort: targetReasoningEffort,
      name: targetName || sourceVerification.name || sourceDatabase.name || null,
      cwd: sourceVerification.cwd,
      threadSource: USER_THREAD_SOURCE,
      isPinned: pinTarget || Boolean(sourceDatabase.is_pinned),
      expectedReasoningNormalizations: targetProvider === "openai"
        ? sourceRollout.reasoningContentArrayCount
        : 0,
      expectedEncryptedReasoningClears: sourceRollout.threadBoundEncryptedReasoningCount,
      expectedWebSearchCallIdNormalizations: targetProvider === "openai"
        ? sourceRollout.invalidWebSearchCallIdCount
        : 0,
      expectedWebSearchEventReferenceNormalizations: targetProvider === "openai"
        ? sourceRollout.invalidWebSearchEventReferenceCount
        : 0,
      expectedOrphanToolOutputDrops: targetProvider === "openai"
        ? 0
        : sourceRollout.orphanToolOutputCount,
    },
    schema: {
      sha256: schema.schemaSha256,
      threadSourceField: schema.threadSourceField,
      threadMetadata: schema.threadMetadata,
    },
    safeToProceed: sourceRollout.parseErrorCount === 0 && !sourceRollout.activeTurn,
  };
  return plan;
}

export async function handoffOne(options) {
  const plan = await buildHandoffPlan(options);
  if (!options.execute) return { type: "handoff-dry-run", plan };
  if (!plan.safeToProceed) throw new Error("handoff 前置检查未通过：源任务正在运行，或 rollout 存在解析错误");

  const targetClientOptions = {
    cwd: PROJECT_CWD,
    configOverrides: appServerProviderOverrides(
      plan.target.provider,
      plan.target.model,
      plan.target.reasoningEffort,
    ),
  };
  let targetThreadId = null;
  let targetRolloutPath = null;
  let verification;
  let normalization = null;
  let historyTransfer = null;
  const pinning = {
    requested: plan.target.isPinned,
    supported: Boolean(plan.schema.threadMetadata?.pinning?.supported),
    applied: false,
    status: plan.target.isPinned ? "unsupported-manual" : "not-requested",
  };
  try {
    const setupClient = await createAppServerClient(targetClientOptions);
    try {
      const startParams = {
        cwd: plan.target.cwd,
        modelProvider: plan.target.provider,
        model: plan.target.model,
        threadSource: plan.target.threadSource,
        historyMode: "paginated",
      };
      if (plan.target.reasoningEffort) {
        startParams.config = { model_reasoning_effort: plan.target.reasoningEffort };
      }
      const startResult = await setupClient.request("thread/start", startParams);
      const startedThread = responseThread(startResult);
      targetThreadId = startedThread?.id || startResult?.threadId || startResult?.id || null;
      targetRolloutPath = startedThread?.path || null;
      if (!targetThreadId) throw new Error("thread/start 没有返回目标任务 ID");

      const prepared = await preparedTargetHistory(plan, targetThreadId);
      await setupClient.request("thread/inject_items", {
        threadId: targetThreadId,
        items: prepared.responseItems,
      });
      if (plan.target.name) {
        await setupClient.request("thread/name/set", { threadId: targetThreadId, name: plan.target.name });
      }
      if (plan.target.isPinned && pinning.supported) {
        const { method, field } = plan.schema.threadMetadata.pinning;
        await setupClient.request(method, { threadId: targetThreadId, [field]: true });
        pinning.applied = true;
        pinning.status = "applied";
      }
      historyTransfer = prepared;
    } finally {
      await setupClient.close();
    }

    targetRolloutPath = targetRolloutPath || stateRow(targetThreadId)?.rollout_path || null;
    if (!targetRolloutPath) throw new Error(`找不到独立目标任务 ${targetThreadId} 的 rollout`);
    const appended = await appendProjectionEvents(targetRolloutPath, historyTransfer.projectionEvents);
    const targetSeedSha256 = await sha256File(targetRolloutPath);

    const verifyClient = await createAppServerClient(targetClientOptions);
    try {
      const resumeParams = {
        threadId: targetThreadId,
        cwd: plan.target.cwd,
        modelProvider: plan.target.provider,
        model: plan.target.model,
        excludeTurns: false,
      };
      if (plan.target.reasoningEffort) {
        resumeParams.config = { model_reasoning_effort: plan.target.reasoningEffort };
      }
      await verifyClient.request("thread/resume", resumeParams);
      verification = await verifyThread(verifyClient, targetThreadId);
    } finally {
      await verifyClient.close();
    }

    normalization = {
      ...historyTransfer.normalized,
      records: undefined,
      sha256After: targetSeedSha256,
    };
    historyTransfer = {
      strategy: "independent-start-inject-project",
      sourceRecordCount: historyTransfer.flattened.records.length,
      sourceSegmentCount: historyTransfer.flattened.segments.length,
      injectedResponseItemCount: historyTransfer.responseItems.length,
      projectionEventCount: appended.projectionEventCount,
      targetSeedRolloutPath: targetRolloutPath,
      targetSeedSha256,
      targetRecordCount: (await rolloutState(targetThreadId)).flattenedRecordCount,
      sourceReference: null,
    };
    if (normalization.normalizedReasoningCount !== plan.target.expectedReasoningNormalizations) {
      throw new Error(`推理字段清洗数量与 dry-run 不一致：预期 ${plan.target.expectedReasoningNormalizations}，实际 ${normalization.normalizedReasoningCount}`);
    }
    if (normalization.clearedEncryptedReasoningCount !== plan.target.expectedEncryptedReasoningClears) {
      throw new Error(`线程绑定加密推理清洗数量与 dry-run 不一致：预期 ${plan.target.expectedEncryptedReasoningClears}，实际 ${normalization.clearedEncryptedReasoningCount}`);
    }
    if (normalization.normalizedWebSearchCallIdCount !== plan.target.expectedWebSearchCallIdNormalizations) {
      throw new Error(`联网搜索调用 ID 清洗数量与 dry-run 不一致：预期 ${plan.target.expectedWebSearchCallIdNormalizations}，实际 ${normalization.normalizedWebSearchCallIdCount}`);
    }
    if (normalization.normalizedWebSearchEventReferenceCount !== plan.target.expectedWebSearchEventReferenceNormalizations) {
      throw new Error(`联网搜索事件引用清洗数量与 dry-run 不一致：预期 ${plan.target.expectedWebSearchEventReferenceNormalizations}，实际 ${normalization.normalizedWebSearchEventReferenceCount}`);
    }
    const droppedOrphanToolOutputCount = (normalization.droppedOrphanToolOutputs || []).length;
    if (droppedOrphanToolOutputCount !== plan.target.expectedOrphanToolOutputDrops) {
      throw new Error(`目标提供商不兼容的工具结果项丢弃数量与 dry-run 不一致：预期 ${plan.target.expectedOrphanToolOutputDrops}，实际 ${droppedOrphanToolOutputCount}`);
    }
  } catch (error) {
    if (!targetThreadId) throw error;
    try {
      await deleteThread(targetThreadId, plan.target.provider, plan.target.model);
    } catch (cleanupError) {
      const original = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${original}；失败目标 ${targetThreadId} 自动删除也失败: ${cleanup}`);
    }
    throw error;
  }

  const targetDatabase = stateRow(targetThreadId);
  const checks = {
    newThreadId: targetThreadId !== plan.source.threadId,
    independentHistory: historyTransfer?.sourceReference === null,
    provider: targetDatabase?.model_provider === plan.target.provider,
    model: plan.target.model ? targetDatabase?.model === plan.target.model : true,
    reasoningEffort: plan.target.reasoningEffort
      ? targetDatabase?.reasoning_effort === plan.target.reasoningEffort
      : true,
    threadSource: targetDatabase?.thread_source === USER_THREAD_SOURCE,
    cwd: verification.cwd === plan.source.cwd,
    turnCount: verification.turnCount === plan.source.turnCount,
    itemCount: verification.itemCount === plan.source.itemCount,
    visibleMessageCount: verification.visibleMessageCount === plan.source.visibleMessageCount,
    isPinned: plan.target.isPinned && pinning.supported ? Boolean(targetDatabase?.is_pinned) : true,
  };
  if (!Object.values(checks).every(Boolean)) {
    await deleteThread(targetThreadId, plan.target.provider, plan.target.model);
    throw new Error(`handoff 验收失败: ${JSON.stringify(checks)}`);
  }

  const entry = {
    sourceThreadId: plan.source.threadId,
    sourceProvider: plan.source.provider,
    sourceModel: plan.source.model,
    sourceRolloutPath: plan.source.rolloutPath,
    sourceRolloutSha256: plan.source.rolloutSha256,
    targetThreadId,
    targetProvider: plan.target.provider,
    targetModel: plan.target.model,
    targetReasoningEffort: targetDatabase?.reasoning_effort || plan.target.reasoningEffort || null,
    targetName: plan.target.name,
    cwd: plan.target.cwd,
    handedOffAt: nowIso(),
    backupRoot: null,
    checks,
    historyTransfer,
    pinning,
    normalization: normalization
      ? {
          applied: normalization.totalNormalizedCount > 0
            || normalization.clearedEncryptedReasoningCount > 0
            || (normalization.droppedOrphanToolOutputs || []).length > 0,
          normalizedReasoningCount: normalization.normalizedReasoningCount,
          clearedEncryptedReasoningCount: normalization.clearedEncryptedReasoningCount,
          normalizedWebSearchCallIdCount: normalization.normalizedWebSearchCallIdCount,
          normalizedWebSearchEventReferenceCount: normalization.normalizedWebSearchEventReferenceCount,
          droppedOrphanToolOutputCount: (normalization.droppedOrphanToolOutputs || []).length,
          droppedOrphanToolOutputs: normalization.droppedOrphanToolOutputs || [],
          targetRolloutSha256After: normalization.sha256After,
          backupPath: null,
        }
      : {
          applied: false,
          normalizedReasoningCount: 0,
          clearedEncryptedReasoningCount: 0,
          normalizedWebSearchCallIdCount: 0,
          normalizedWebSearchEventReferenceCount: 0,
          droppedOrphanToolOutputCount: 0,
          droppedOrphanToolOutputs: [],
        },
    providerCompat: {
      targetProvider: plan.target.provider,
      droppedOrphanToolOutputCount: (normalization?.droppedOrphanToolOutputs || []).length,
      droppedOrphanToolOutputs: normalization?.droppedOrphanToolOutputs || [],
    },
  };
  return { type: "handed-off", plan, backup: null, entry, verification, targetDatabase };
}

export async function deleteThread(threadId, provider, model = null) {
  const client = await createAppServerClient({
    cwd: PROJECT_CWD,
    configOverrides: appServerProviderOverrides(provider, model),
  });
  try {
    await client.request("thread/delete", { threadId });
  } finally {
    await client.close();
  }
  const after = stateRow(threadId);
  return {
    threadId,
    deleted: after === null,
    recoverableWith: null,
  };
}

export async function archiveThread(threadId, provider, model = null) {
  const client = await createAppServerClient({
    cwd: PROJECT_CWD,
    configOverrides: appServerProviderOverrides(provider, model),
  });
  try {
    await client.request("thread/archive", { threadId });
  } finally {
    await client.close();
  }
  const after = stateRow(threadId);
  return {
    threadId,
    archived: Boolean(after?.archived),
  };
}


import fs from "node:fs/promises";
import path from "node:path";

import { archiveThread, handoffOne, rolloutState, stateRow } from "./handoff-engine.mjs";
import {
  BATCH_HANDOFF_MANIFEST_PATH,
  PROJECT_CWD,
  REPORT_DIR,
} from "./constants.mjs";
import { readFlattenedRollout } from "./rollout-reader.mjs";
import { readBatchManifest } from "./batch-handoff-engine.mjs";
import { repeatedTailInfo } from "./pair-sync-signatures.mjs";
import { atomicWriteJson, nowIso, timestampForPath } from "./utils.mjs";
import {
  mapProjectCwd,
  readHandoffSettings,
  resolveTargetModel,
  resolveTargetReasoningEffort,
} from "./provider-config.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStableTaskIds(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

export async function buildPairRepairPlan({
  targetProvider = "deepseek",
  stableTaskIds,
  strategy = "clean-rebuild",
} = {}) {
  if (strategy !== "clean-rebuild") throw new Error(`不支持的配对修复策略：${strategy}`);
  const requestedTaskIds = normalizeStableTaskIds(stableTaskIds);
  if (requestedTaskIds.length === 0) throw new Error("pair-repair 需要 --stable-task-ids");
  const settings = await readHandoffSettings();
  if (!settings.managedProviders?.[targetProvider]) {
    throw new Error(`目标提供商未在 handoff-settings.json 中启用：${targetProvider}`);
  }
  const manifest = await readBatchManifest();
  const items = [];
  for (const stableTaskId of requestedTaskIds) {
    const task = manifest.tasks.find((candidate) => candidate.stableTaskId === stableTaskId);
    if (!task) {
      items.push({ stableTaskId, action: "blocked", reason: "task-not-found" });
      continue;
    }
    const sourceProvider = targetProvider === "openai" ? "deepseek" : "openai";
    const sourceThreadId = task.providerThreads?.[sourceProvider] || null;
    const oldTargetThreadId = task.providerThreads?.[targetProvider] || null;
    const sourceRow = sourceThreadId ? stateRow(sourceThreadId) : null;
    const targetRow = oldTargetThreadId ? stateRow(oldTargetThreadId) : null;
    if (!sourceThreadId || !sourceRow || !oldTargetThreadId || !targetRow) {
      items.push({
        stableTaskId,
        displayName: task.displayName,
        action: "blocked",
        reason: "pair-endpoint-missing",
        sourceThreadId,
        oldTargetThreadId,
      });
      continue;
    }
    const sourceRollout = await rolloutState(sourceThreadId);
    const targetRollout = await rolloutState(oldTargetThreadId);
    const targetHistory = await readFlattenedRollout(targetRollout.rolloutPath);
    const targetCursor = Number(task.pairSync?.[targetProvider]?.recordCount);
    const duplicateDelta = Number.isFinite(targetCursor)
      ? repeatedTailInfo(targetHistory.records, targetCursor)
      : null;
    const targetModel = targetRow.model || resolveTargetModel(settings, targetProvider, task);
    const targetReasoningEffort = targetRow.reasoning_effort
      || resolveTargetReasoningEffort(settings, targetProvider, task);
    const blocked = sourceRollout.parseErrorCount > 0 || sourceRollout.activeTurn;
    items.push({
      stableTaskId,
      displayName: task.displayName,
      action: blocked ? "blocked" : "rebuild",
      reason: blocked ? (sourceRollout.activeTurn ? "active-turn" : "source-rollout-parse-errors") : null,
      sourceProvider,
      sourceThreadId,
      sourceModel: sourceRow.model,
      sourceRecordCount: sourceRollout.flattenedRecordCount,
      sourceRolloutSha256: sourceRollout.rolloutSha256,
      oldTargetThreadId,
      oldTargetProvider: targetProvider,
      oldTargetModel: targetRow.model,
      oldTargetRecordCount: targetRollout.flattenedRecordCount,
      targetCursor,
      duplicateDelta,
      targetModel,
      targetReasoningEffort,
      cwd: mapProjectCwd(settings, sourceRow.cwd || task.canonicalCwd),
      oldTargetRolloutPath: targetRollout.rolloutPath,
      sourceRetained: true,
    });
  }
  return {
    type: "pair-repair-dry-run",
    generatedAt: nowIso(),
    strategy,
    targetProvider,
    requestedTaskIds,
    items,
    canExecute: items.length > 0 && items.every((item) => item.action === "rebuild"),
    manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
    settingsPath: path.resolve(PROJECT_CWD, "work", "thread-localizer", "data", "handoff-settings.json"),
  };
}

export async function pairRepair({
  targetProvider = "deepseek",
  stableTaskIds,
  strategy = "clean-rebuild",
  execute = false,
} = {}) {
  const plan = await buildPairRepairPlan({ targetProvider, stableTaskIds, strategy });
  const dryRunPath = path.join(REPORT_DIR, `pair-repair-dry-run-${timestampForPath()}.json`);
  await atomicWriteJson(dryRunPath, plan);
  if (!execute) return { ...plan, dryRunPath };
  if (!plan.canExecute) throw new Error(`pair-repair dry-run 未通过：${dryRunPath}`);

  const staged = [];
  let manifestCommitted = false;
  try {
    for (const item of plan.items) {
      const result = await handoffOne({
        execute: true,
        sourceThreadId: item.sourceThreadId,
        targetProvider,
        targetModel: item.targetModel,
        targetReasoningEffort: item.targetReasoningEffort,
        targetName: item.displayName,
        pinTarget: false,
      });
      staged.push({ ...item, replacement: result });
    }

    const manifest = clone(await readBatchManifest());
    const recoveryEntries = [];
    for (const stagedItem of staged) {
      const task = manifest.tasks.find((candidate) => candidate.stableTaskId === stagedItem.stableTaskId);
      if (!task) throw new Error(`修复提交时找不到任务：${stagedItem.stableTaskId}`);
      const replacement = stagedItem.replacement;
      const targetThreadId = replacement.entry.targetThreadId;
      task.providerThreads = {
        ...(task.providerThreads || {}),
        [stagedItem.sourceProvider]: stagedItem.sourceThreadId,
        [targetProvider]: targetThreadId,
      };
      task.providerModels = {
        ...(task.providerModels || {}),
        [targetProvider]: stagedItem.targetModel,
      };
      task.providerReasoningEfforts = {
        ...(task.providerReasoningEfforts || {}),
        [targetProvider]: stagedItem.targetReasoningEffort,
      };
      task.currentThreadId = targetThreadId;
      task.currentProvider = targetProvider;
      task.currentModel = stagedItem.targetModel;
      task.currentReasoningEffort = stagedItem.targetReasoningEffort;
      task.pairSync = {
        ...(task.pairSync || {}),
        [stagedItem.sourceProvider]: {
          threadId: stagedItem.sourceThreadId,
          recordCount: stagedItem.replacement.historyTransfer?.sourceRecordCount
            ?? stagedItem.replacement.sourceRecordCount,
        },
        [targetProvider]: {
          threadId: targetThreadId,
          recordCount: stagedItem.replacement.historyTransfer?.targetRecordCount
            ?? stagedItem.replacement.targetRecordCount
            ?? 0,
        },
      };
      task.pendingSync = null;
      task.lastError = null;
      task.handoffs = [
        ...(task.handoffs || []),
        {
          ...stagedItem.replacement.entry,
          sourceRetained: true,
          sourceDeleted: false,
          pairMode: true,
          recovery: "clean-rebuild-after-duplicate-delta",
          replacedTargetThreadId: stagedItem.oldTargetThreadId,
          replacedTargetRolloutPath: stagedItem.oldTargetRolloutPath,
        },
      ];
      recoveryEntries.push({
        stableTaskId: stagedItem.stableTaskId,
        oldTargetThreadId: stagedItem.oldTargetThreadId,
        newTargetThreadId: targetThreadId,
        oldTargetRolloutPath: stagedItem.oldTargetRolloutPath,
        newTargetRolloutPath: replacement.entry.targetRolloutPath || null,
        oldTargetRecordCount: stagedItem.oldTargetRecordCount,
        newTargetRecordCount: replacement.historyTransfer?.targetRecordCount
          ?? replacement.targetRecordCount,
        sourceRecordCount: replacement.historyTransfer?.sourceRecordCount
          ?? replacement.sourceRecordCount,
      });
    }
    manifest.updatedAt = nowIso();
    manifest.recoveries = [...(manifest.recoveries || []), {
      recoveredAt: nowIso(),
      strategy,
      targetProvider,
      entries: recoveryEntries,
    }].slice(-50);
    await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, manifest);
    manifestCommitted = true;

    const archived = [];
    for (const stagedItem of staged) {
      try {
        const result = await archiveThread(
          stagedItem.oldTargetThreadId,
          stagedItem.oldTargetProvider,
          stagedItem.oldTargetModel,
        );
        archived.push({ ...result, stableTaskId: stagedItem.stableTaskId });
      } catch (archiveError) {
        archived.push({
          stableTaskId: stagedItem.stableTaskId,
          threadId: stagedItem.oldTargetThreadId,
          archived: false,
          error: archiveError instanceof Error ? archiveError.message : String(archiveError),
        });
      }
    }
    const resultPath = path.join(REPORT_DIR, `pair-repair-result-${timestampForPath()}.json`);
    const output = {
      type: "pair-repair-complete",
      strategy,
      targetProvider,
      dryRunPath,
      resultPath,
      replacements: recoveryEntries,
      archived,
      manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
    };
    await atomicWriteJson(resultPath, output);
    return output;
  } catch (error) {
    if (manifestCommitted) throw error;
    for (const stagedItem of staged) {
      const replacementId = stagedItem.replacement?.entry?.targetThreadId;
      if (!replacementId) continue;
      try {
        await archiveThread(replacementId, targetProvider, stagedItem.targetModel);
      } catch {
        // Preserve the original failure; the staged endpoint remains discoverable for manual cleanup.
      }
    }
    throw error;
  }
}

export async function pairRepairFinalize({ targetProvider = "deepseek", stableTaskIds } = {}) {
  const requestedTaskIds = normalizeStableTaskIds(stableTaskIds);
  if (requestedTaskIds.length === 0) throw new Error("pair-repair-finalize 需要 --stable-task-ids");
  const manifest = clone(await readBatchManifest());
  const finalized = [];
  for (const stableTaskId of requestedTaskIds) {
    const task = manifest.tasks.find((candidate) => candidate.stableTaskId === stableTaskId);
    if (!task) throw new Error(`找不到任务：${stableTaskId}`);
    const entry = [...(task.handoffs || [])]
      .reverse()
      .find((candidate) => (
        candidate.recovery === "clean-rebuild-after-duplicate-delta"
        && candidate.targetProvider === targetProvider
      ));
    if (!entry) throw new Error(`任务 ${stableTaskId} 缺少 clean-rebuild 恢复记录`);
    const sourceRecordCount = Number(entry.historyTransfer?.sourceRecordCount);
    const targetRecordCount = Number(entry.historyTransfer?.targetRecordCount);
    if (!Number.isFinite(sourceRecordCount) || !Number.isFinite(targetRecordCount)) {
      throw new Error(`任务 ${stableTaskId} 的恢复记录缺少有效同步游标`);
    }
    task.pairSync = {
      ...(task.pairSync || {}),
      [entry.sourceProvider]: {
        threadId: entry.sourceThreadId,
        recordCount: sourceRecordCount,
      },
      [targetProvider]: {
        threadId: entry.targetThreadId,
        recordCount: targetRecordCount,
      },
    };
    task.pendingSync = null;
    task.lastError = null;
    finalized.push({
      stableTaskId,
      sourceThreadId: entry.sourceThreadId,
      sourceRecordCount,
      targetThreadId: entry.targetThreadId,
      targetRecordCount,
    });
  }
  manifest.updatedAt = nowIso();
  await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, manifest);
  return {
    type: "pair-repair-finalized",
    targetProvider,
    finalized,
    manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
  };
}

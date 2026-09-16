import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAppServerClient } from "./appserver-client.mjs";
import {
  BATCH_HANDOFF_MANIFEST_PATH,
  CODEX_HOME,
  PROJECT_CWD,
  REPORT_DIR,
} from "./constants.mjs";
import { deleteThread, handoffOne, rolloutState, stateRow } from "./handoff-engine.mjs";
import { probeExistingPairTarget, syncExistingPair } from "./paired-handoff-engine.mjs";
import { ensurePairTags, stripProviderTag } from "./pair-tagging.mjs";
import { backfillThreadPreviews } from "./thread-preview-backfill.mjs";
import { readFlattenedRollout } from "./rollout-reader.mjs";
import { repeatedTailInfo } from "./pair-sync-signatures.mjs";
import {
  mapProjectCwd,
  normalizeCwd,
  readHandoffSettings,
  resolveTargetModel,
  resolveTargetReasoningEffort,
} from "./provider-config.mjs";
import { loadAndValidateSchema } from "./schema-guard.mjs";
import {
  atomicWriteJson,
  nowIso,
  pathExists,
  responseCursor,
  timestampForPath,
} from "./utils.mjs";

async function readJsonIfPresent(filePath, fallback) {
  if (!(await pathExists(filePath))) return fallback;
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readBatchManifest() {
  const manifest = await readJsonIfPresent(BATCH_HANDOFF_MANIFEST_PATH, {
    version: 2,
    updatedAt: null,
    legacyImport: null,
    tasks: [],
    runs: [],
  });
  if (manifest.version !== 2 || !Array.isArray(manifest.tasks) || !Array.isArray(manifest.runs)) {
    throw new Error("batch-handoff-manifest.json 格式无效");
  }
  return manifest;
}

function compactName(value, threadId) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return `未命名任务 ${threadId.slice(-8)}`;
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function excludedReason(settings, task) {
  const discovery = settings.discovery || {};
  if ((discovery.excludeThreadIds || []).includes(task.id)) return "thread-id-excluded";
  const matchedPrefix = (discovery.excludeNamePrefixes || []).find((prefix) => task.displayName.startsWith(prefix));
  return matchedPrefix ? `name-prefix-excluded:${matchedPrefix}` : null;
}

async function listAllInteractiveThreads() {
  const client = await createAppServerClient({ cwd: PROJECT_CWD });
  const threads = [];
  let cursor = null;
  const seen = new Set();
  try {
    for (;;) {
      const params = {
        archived: false,
        limit: 100,
        modelProviders: [],
        sortKey: "updated_at",
        sortDirection: "desc",
        // Allow Codex to scan rollouts and repair metadata for a freshly
        // reconstructed independent task before the picker consumes the list.
        useStateDbOnly: false,
      };
      if (cursor) params.cursor = cursor;
      const result = await client.request("thread/list", params);
      threads.push(...(Array.isArray(result?.data) ? result.data : []));
      const next = responseCursor(result);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
  } finally {
    await client.close();
  }
  return dedupeThreadsById(threads);
}

export function dedupeThreadsById(threads) {
  const byId = new Map();
  for (const thread of threads || []) {
    if (!thread?.id) continue;
    const existing = byId.get(thread.id);
    if (!existing || Number(thread.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      byId.set(thread.id, thread);
    }
  }
  return [...byId.values()];
}

export async function discoverLocalTasks(settings = null) {
  const resolvedSettings = settings || await readHandoffSettings();
  const threads = await listAllInteractiveThreads();
  const db = new DatabaseSync(path.join(CODEX_HOME, "state_5.sqlite"), { readOnly: true });
  const statement = db.prepare(`SELECT id, name, title, model_provider, model, reasoning_effort, cwd, rollout_path,
    thread_source, archived, is_pinned, created_at, updated_at, recency_at FROM threads WHERE id = ?`);
  try {
    return threads.map((thread) => {
      const row = statement.get(thread.id) || {};
      const explicitName = stripProviderTag(thread.name || row.name) || null;
      const displayName = compactName(explicitName || thread.name || row.title, thread.id);
      const task = {
        id: thread.id,
        displayName,
        explicitName,
        provider: thread.modelProvider || row.model_provider || null,
        model: row.model || null,
        reasoningEffort: row.reasoning_effort || null,
        cwd: mapProjectCwd(resolvedSettings, thread.cwd || row.cwd),
        originalCwd: normalizeCwd(thread.cwd || row.cwd),
        rolloutPath: thread.path || row.rollout_path || null,
        isPinned: Boolean(thread.isPinned ?? row.is_pinned),
        threadSource: row.thread_source || thread.threadSource || null,
        source: thread.source || null,
        status: thread.status?.type || null,
        updatedAt: thread.updatedAt || row.updated_at || row.recency_at || row.created_at || null,
      };
      return {
        ...task,
        managed: Boolean(resolvedSettings.managedProviders?.[task.provider]),
        excludedReason: excludedReason(resolvedSettings, task),
      };
    });
  } finally {
    db.close();
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDiscoveredTasks(manifest, discovered) {
  const next = clone(manifest);
  const tasks = Array.isArray(next.tasks) ? next.tasks : [];
  const predecessorIds = new Set(tasks.flatMap((task) => (
    (task.handoffs || [])
      .filter((handoff) => !handoff.sourceRetained)
      .map((handoff) => handoff.sourceThreadId)
      .filter(Boolean)
  )));

  for (const item of discovered) {
    if (!item.managed || item.excludedReason) continue;
    if (predecessorIds.has(item.id)) continue;
    let task = tasks.find((candidate) => (
      candidate.currentThreadId === item.id
      || Object.values(candidate.providerThreads || {}).includes(item.id)
    )) || null;
    if (!task) {
      task = {
        stableTaskId: item.id,
        displayName: item.displayName,
        explicitName: item.explicitName,
        canonicalCwd: item.cwd,
        isPinned: item.isPinned,
        currentThreadId: item.id,
        currentProvider: item.provider,
        currentModel: item.model,
        currentReasoningEffort: item.reasoningEffort,
        providerModels: item.model ? { [item.provider]: item.model } : {},
        providerReasoningEfforts: item.reasoningEffort
          ? { [item.provider]: item.reasoningEffort }
          : {},
        providerThreads: { [item.provider]: item.id },
        pairSync: {},
        enrolledAt: nowIso(),
        enrolledFrom: "auto-discovery",
        lastSeenAt: nowIso(),
        handoffs: [],
        lastError: null,
      };
      tasks.push(task);
    } else {
      const isCurrentThread = task.currentThreadId === item.id;
      task.displayName = item.displayName || task.displayName;
      task.explicitName = item.explicitName ?? task.explicitName ?? null;
      task.canonicalCwd = item.cwd || task.canonicalCwd;
      task.isPinned = item.isPinned;
      task.providerThreads = { ...(task.providerThreads || {}), [item.provider]: item.id };
      if (isCurrentThread) {
        task.currentProvider = item.provider;
        task.currentModel = item.model;
        task.currentReasoningEffort = item.reasoningEffort;
      }
      task.providerModels = { ...(task.providerModels || {}) };
      if (item.model) task.providerModels[item.provider] = item.model;
      task.providerReasoningEfforts = { ...(task.providerReasoningEfforts || {}) };
      if (item.reasoningEffort) task.providerReasoningEfforts[item.provider] = item.reasoningEffort;
      task.lastSeenAt = nowIso();
      task.lastError = null;
    }
  }

  next.tasks = tasks;
  return next;
}

function findTask(manifest, stableTaskId) {
  return manifest.tasks.find((task) => task.stableTaskId === stableTaskId) || null;
}

export function pairedResultStatus(result) {
  return result?.type === "paired-noop" ? "noop" : "handed-off";
}

export function normalizeTaskIds({ onlyTaskId = null, taskIds = null } = {}) {
  const values = [];
  if (Array.isArray(taskIds)) values.push(...taskIds);
  else if (typeof taskIds === "string") values.push(...taskIds.split(","));
  if (onlyTaskId) values.push(onlyTaskId);
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export async function buildHandoffCandidates({ targetProvider = null } = {}) {
  const settings = await readHandoffSettings();
  const [manifest, discovered] = await Promise.all([
    readBatchManifest(),
    discoverLocalTasks(settings),
  ]);
  const merged = mergeDiscoveredTasks(manifest, discovered);
  const discoveredById = new Map(discovered.map((item) => [item.id, item]));
  const candidates = [];
  for (const task of merged.tasks) {
    const endpoints = Object.entries(task.providerThreads || {});
    if (endpoints.length === 0 && task.currentThreadId) {
      endpoints.push([task.currentProvider, task.currentThreadId]);
    }
    for (const [provider, threadId] of endpoints) {
      const engineTarget = targetProvider === "gpt" ? "openai" : targetProvider;
      if (!threadId || (engineTarget && provider === engineTarget)) continue;
      const row = stateRow(threadId);
      if (!row || row.archived) continue;
      const discoveredItem = discoveredById.get(threadId);
      candidates.push({
        id: threadId,
        stableTaskId: task.stableTaskId,
        displayName: stripProviderTag(task.displayName || row.name || row.title)
          || compactName(null, threadId),
        explicitName: stripProviderTag(task.explicitName || row.name) || null,
        provider: row.model_provider || provider,
        model: row.model || task.providerModels?.[provider] || null,
        reasoningEffort: row.reasoning_effort || task.providerReasoningEfforts?.[provider] || null,
        cwd: mapProjectCwd(settings, row.cwd || task.canonicalCwd),
        originalCwd: normalizeCwd(row.cwd || task.canonicalCwd),
        isPinned: Boolean(row.is_pinned),
        status: discoveredItem?.status || null,
        updatedAt: discoveredItem?.updatedAt || row.updated_at || row.recency_at || row.created_at || null,
        managed: Boolean(settings.managedProviders?.[row.model_provider || provider]),
        paired: Boolean(task.providerThreads?.[engineTarget]),
        pairedTargetThreadId: task.providerThreads?.[engineTarget] || null,
      });
    }
  }
  const byId = new Map();
  for (const candidate of candidates) byId.set(candidate.id, candidate);
  return [...byId.values()];
}

export async function buildBatchHandoffPlan({ targetProvider, onlyTaskId = null, taskIds = null, forceRebuild = false } = {}) {
  if (forceRebuild && !onlyTaskId) {
    throw new Error("--force-rebuild 必须与 --only-task-id 一起使用");
  }
  const settings = await readHandoffSettings();
  if (!settings.managedProviders?.[targetProvider]) {
    throw new Error(`目标提供商未在 handoff-settings.json 中启用: ${targetProvider}`);
  }
  const schema = await loadAndValidateSchema();
  const [manifest, discovered] = await Promise.all([
    readBatchManifest(),
    discoverLocalTasks(settings),
  ]);
  const nextManifest = mergeDiscoveredTasks(manifest, discovered);
  const requestedTaskIds = normalizeTaskIds({ onlyTaskId, taskIds });
  const requestedMode = requestedTaskIds.length > 0;
  const predecessorIds = new Set(nextManifest.tasks.flatMap((task) => (
    (task.handoffs || [])
      .filter((handoff) => !handoff.sourceRetained)
      .map((handoff) => handoff.sourceThreadId)
      .filter(Boolean)
  )));
  const items = [];
  const requestedCandidates = requestedMode ? requestedTaskIds.map((requestedId) => {
    const task = nextManifest.tasks.find((candidate) => (
      candidate.stableTaskId === requestedId
      || candidate.currentThreadId === requestedId
      || Object.values(candidate.providerThreads || {}).includes(requestedId)
    ));
    if (!task) return { requestedId, unresolved: true };
    const sourceThreadId = Object.values(task.providerThreads || {}).includes(requestedId)
      ? requestedId
      : task.currentThreadId;
    const row = stateRow(sourceThreadId);
    if (!row) return { requestedId, task, sourceThreadId, unresolved: true, error: "state_5.sqlite 中找不到所选源端点" };
    return {
      requestedId,
      task,
      sourceThreadId,
      unresolved: false,
      displayName: task.displayName || row.name || row.title || compactName(null, sourceThreadId),
      provider: row.model_provider || task.currentProvider,
      model: row.model || task.providerModels?.[row.model_provider] || null,
      reasoningEffort: row.reasoning_effort || task.providerReasoningEfforts?.[row.model_provider] || null,
      cwd: mapProjectCwd(settings, row.cwd || task.canonicalCwd),
      originalCwd: normalizeCwd(row.cwd || task.canonicalCwd),
      isPinned: Boolean(row.is_pinned),
      status: null,
    };
  }) : [];
  for (const candidate of requestedCandidates.filter((item) => item.unresolved)) {
    items.push({
      stableTaskId: candidate.task?.stableTaskId || candidate.requestedId,
      sourceThreadId: candidate.sourceThreadId || candidate.requestedId,
      displayName: candidate.task?.displayName || candidate.requestedId,
      action: "blocked",
      reason: "requested-task-unresolved",
      error: candidate.error || "所选任务不在 manifest 或 Codex state DB 中",
    });
  }

  const loopTasks = requestedMode
    ? requestedCandidates.filter((item) => !item.unresolved).map((item) => ({
        id: item.sourceThreadId,
        displayName: item.displayName,
        explicitName: item.task.explicitName,
        provider: item.provider,
        model: item.model,
        reasoningEffort: item.reasoningEffort,
        cwd: item.cwd,
        originalCwd: item.originalCwd,
        isPinned: item.isPinned,
        status: item.status,
        managed: Boolean(settings.managedProviders?.[item.provider]),
        excludedReason: null,
        forcedTask: item.task,
      }))
    : discovered;

  for (const discoveredTask of loopTasks) {
    if (predecessorIds.has(discoveredTask.id)) {
      items.push({
        stableTaskId: null,
        sourceThreadId: discoveredTask.id,
        displayName: discoveredTask.displayName,
        action: "skip",
        reason: "retired-handoff-predecessor",
      });
      continue;
    }
    if (!discoveredTask.managed) {
      items.push({
        stableTaskId: null,
        sourceThreadId: discoveredTask.id,
        displayName: discoveredTask.displayName,
        sourceProvider: discoveredTask.provider,
        sourceModel: discoveredTask.model,
        cwd: discoveredTask.cwd,
        action: "skip",
        reason: "unmanaged-provider",
      });
      continue;
    }
    if (discoveredTask.excludedReason) {
      items.push({
        stableTaskId: null,
        sourceThreadId: discoveredTask.id,
        displayName: discoveredTask.displayName,
        sourceProvider: discoveredTask.provider,
        sourceModel: discoveredTask.model,
        cwd: discoveredTask.cwd,
        action: "skip",
        reason: discoveredTask.excludedReason,
      });
      continue;
    }

    const task = discoveredTask.forcedTask || nextManifest.tasks.find((candidate) => (
      candidate.currentThreadId === discoveredTask.id
      || Object.values(candidate.providerThreads || {}).includes(discoveredTask.id)
    ));
    if (!task) throw new Error(`发现任务未能写入候选 manifest: ${discoveredTask.id}`);
    if (!requestedMode && task.currentThreadId !== discoveredTask.id) {
      items.push({
        stableTaskId: task.stableTaskId,
        sourceThreadId: discoveredTask.id,
        displayName: discoveredTask.displayName,
        action: "skip",
        reason: "paired-peer",
      });
      continue;
    }
    const selected = requestedMode || !onlyTaskId
      || task.stableTaskId === onlyTaskId
      || task.currentThreadId === onlyTaskId;
    const pairedTargetThreadId = task.providerThreads?.[targetProvider] || null;
    const pairedTargetRow = pairedTargetThreadId ? stateRow(pairedTargetThreadId) : null;
    const targetModel = pairedTargetRow?.model || resolveTargetModel(settings, targetProvider, task);
    const targetReasoningEffort = pairedTargetRow?.reasoning_effort
      || resolveTargetReasoningEffort(settings, targetProvider, task);
    const common = {
      stableTaskId: task.stableTaskId,
      sourceThreadId: discoveredTask.id,
      displayName: task.displayName,
      sourceProvider: discoveredTask.provider || task.currentProvider,
      sourceModel: discoveredTask.model || task.currentModel,
      sourceReasoningEffort: discoveredTask.reasoningEffort || task.currentReasoningEffort || null,
      targetProvider,
      targetModel,
      targetReasoningEffort,
      pairedTargetThreadId,
      cwd: task.canonicalCwd,
      isPinned: task.isPinned,
      pinning: {
        requested: task.isPinned,
        supported: Boolean(schema.threadMetadata?.pinning?.supported),
        action: task.isPinned && !schema.threadMetadata?.pinning?.supported
          ? "continue-unpinned-manual"
          : (task.isPinned ? "copy" : "not-requested"),
      },
    };
    if (!selected) {
      items.push({ ...common, action: "skip", reason: "not-selected" });
      continue;
    }
    if (
      !forceRebuild
      &&
      common.sourceProvider === targetProvider
      && common.sourceModel === targetModel
      && (!targetReasoningEffort || common.sourceReasoningEffort === targetReasoningEffort)
    ) {
      items.push({ ...common, action: "noop", reason: "already-on-target-provider-and-model" });
      continue;
    }
    try {
      const rollout = await rolloutState(discoveredTask.id);
      const safe = rollout.parseErrorCount === 0 && !rollout.activeTurn;
      const rolloutDetails = {
        sourceRolloutPath: rollout.rolloutPath,
        sourceRolloutSha256: rollout.rolloutSha256,
        parseErrorCount: rollout.parseErrorCount,
        activeTurn: rollout.activeTurn,
        expectedReasoningNormalizations: targetProvider === "openai"
          ? rollout.reasoningContentArrayCount
          : 0,
        expectedEncryptedReasoningClears: rollout.threadBoundEncryptedReasoningCount,
        expectedWebSearchCallIdNormalizations: targetProvider === "openai"
          ? rollout.invalidWebSearchCallIdCount
          : 0,
        expectedWebSearchEventReferenceNormalizations: targetProvider === "openai"
          ? rollout.invalidWebSearchEventReferenceCount
          : 0,
        providerCompat: {
          targetProvider,
          sourceOrphanToolOutputCount: targetProvider === "openai"
            ? 0
            : rollout.orphanToolOutputCount || 0,
          sourceOrphanToolOutputs: targetProvider === "openai"
            ? []
            : rollout.orphanToolOutputs || [],
        },
      };
      const pairedMode = !forceRebuild
        && pairedTargetThreadId
        && pairedTargetThreadId !== discoveredTask.id;
      const pairCursor = pairedMode ? task.pairSync?.[common.sourceProvider] : null;
      const targetPairCursor = pairedMode ? task.pairSync?.[targetProvider] : null;
      const cursorRecordCount = pairCursor ? Number(pairCursor.recordCount) : NaN;

      if (!safe) {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "blocked",
          reason: rollout.activeTurn ? "active-turn" : "rollout-parse-errors",
        });
        continue;
      }
      if (pairedMode && (!pairCursor || pairCursor.threadId !== discoveredTask.id || !Number.isFinite(cursorRecordCount))) {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "blocked",
          reason: "missing-pair-cursor",
          error: `找不到 ${common.sourceProvider} 源端点 ${discoveredTask.id} 的有效配对同步游标`,
        });
        continue;
      }
      if (pairedMode && (!targetPairCursor || targetPairCursor.threadId !== pairedTargetThreadId)) {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "blocked",
          reason: "missing-pair-target-cursor",
          error: `找不到 ${targetProvider} 配对端点 ${pairedTargetThreadId} 的有效同步游标`,
        });
        continue;
      }
      if (pairedMode) {
        const targetRollout = await rolloutState(pairedTargetThreadId);
        const targetHistory = await readFlattenedRollout(targetRollout.rolloutPath);
        const duplicate = repeatedTailInfo(targetHistory.records, Number(targetPairCursor.recordCount));
        if (duplicate && duplicate.copies > 1) {
          items.push({
            ...common,
            ...rolloutDetails,
            action: "blocked",
            reason: "duplicate-delta-detected",
            error: `目标端点 ${pairedTargetThreadId} 在同步游标后检测到 ${duplicate.copies} 份相同历史块（${duplicate.blockRecordCount} 条/份，指纹 ${duplicate.fingerprint}）`,
            duplicateDelta: duplicate,
          });
          continue;
        }
      }
      if (pairedMode && rollout.flattenedRecordCount < cursorRecordCount) {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "blocked",
          reason: "pair-cursor-ahead",
          error: `配对游标 ${cursorRecordCount} 超过当前源历史 ${rollout.flattenedRecordCount} 条`,
        });
        continue;
      }
      if (pairedMode && task.lastError?.reason === "partial-sync") {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "blocked",
          reason: "partial-sync-recovery-required",
          error: task.lastError.message || "上一次配对同步可能已部分写入，需先完成恢复检查",
        });
        continue;
      }
      if (pairedMode && rollout.flattenedRecordCount === cursorRecordCount) {
        items.push({
          ...common,
          ...rolloutDetails,
          action: "noop",
          reason: "paired-source-cursor-up-to-date",
          targetThreadId: pairedTargetThreadId,
        });
        continue;
      }
      let targetProbe = null;
      if (pairedMode) {
        try {
          targetProbe = await probeExistingPairTarget({
            targetThreadId: pairedTargetThreadId,
            targetProvider,
            targetModel,
            targetReasoningEffort,
            cwd: task.canonicalCwd,
          });
        } catch (error) {
          items.push({
            ...common,
            ...rolloutDetails,
            action: "blocked",
            reason: "paired-target-unreadable",
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      items.push({
        ...common,
        ...rolloutDetails,
        action: "handoff",
        reason: null,
        pairedTargetProbeMethod: targetProbe?.method || null,
      });
    } catch (error) {
      items.push({
        ...common,
        action: "blocked",
        reason: "rollout-inspection-failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const counts = items.reduce((result, item) => {
    result[item.action] = (result[item.action] || 0) + 1;
    return result;
  }, {});
  return {
    type: "batch-handoff-dry-run",
    generatedAt: nowIso(),
    targetProvider,
    targetModel: settings.managedProviders[targetProvider].activeModel,
    targetReasoningEffort: settings.managedProviders[targetProvider].reasoningEffort || null,
    handoffMode: settings.handoffMode || "single",
    onlyTaskId,
    requestedTaskIds,
    requestedMode,
    resolvedTaskIds: items.filter((item) => item.action !== "blocked").map((item) => item.sourceThreadId),
    unresolvedTaskIds: items.filter((item) => item.action === "blocked").map((item) => item.sourceThreadId),
    forceRebuild,
    schema: {
      sha256: schema.schemaSha256,
      threadSourceField: schema.threadSourceField,
      threadMetadata: schema.threadMetadata,
    },
    settingsPath: path.resolve(PROJECT_CWD, "work", "thread-localizer", "data", "handoff-settings.json"),
    manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
    discoveredCount: discovered.length,
    managedTaskCount: nextManifest.tasks.length,
    counts,
    items,
    nextManifest,
  };
}

function replaceTask(manifest, updatedTask) {
  manifest.tasks = manifest.tasks.map((task) => (
    task.stableTaskId === updatedTask.stableTaskId ? updatedTask : task
  ));
}

async function applyPairTaggingSafely(task, cwd = null) {
  const openaiThreadId = task.providerThreads?.openai || null;
  const deepseekThreadId = task.providerThreads?.deepseek || null;
  if (!openaiThreadId || !deepseekThreadId || openaiThreadId === deepseekThreadId) {
    return { applied: false, reason: "pair-incomplete", baseName: null, tags: {} };
  }
  try {
    const tagging = await ensurePairTags({
      openaiThreadId,
      deepseekThreadId,
      fallbackName: stripProviderTag(task.explicitName || task.displayName) || null,
      cwd: cwd || task.canonicalCwd || null,
    });
    if (tagging.baseName) {
      task.displayName = tagging.baseName;
      task.baseDisplayName = tagging.baseName;
    }
    task.lastTagging = {
      at: nowIso(),
      applied: tagging.applied,
      baseName: tagging.baseName,
      tags: tagging.tags,
      reason: tagging.reason || null,
    };
    return tagging;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    task.lastTagging = { at: nowIso(), applied: false, baseName: null, tags: {}, reason };
    return { applied: false, reason, baseName: null, tags: {} };
  }
}

export async function tagPairedEndpoints({ stableTaskIds = null } = {}) {
  const manifest = await readBatchManifest();
  const requested = new Set(normalizeTaskIds({ taskIds: stableTaskIds }));
  const results = [];
  for (const task of manifest.tasks || []) {
    const openaiThreadId = task.providerThreads?.openai || null;
    const deepseekThreadId = task.providerThreads?.deepseek || null;
    if (!openaiThreadId || !deepseekThreadId || openaiThreadId === deepseekThreadId) continue;
    if (requested.size > 0 && !requested.has(task.stableTaskId)) continue;
    const tagging = await applyPairTaggingSafely(task, task.canonicalCwd);
    results.push({
      stableTaskId: task.stableTaskId,
      displayName: task.displayName || null,
      openaiThreadId,
      deepseekThreadId,
      tagging,
    });
  }
  manifest.updatedAt = nowIso();
  await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, manifest);
  return {
    type: "pairs-tagged",
    taggedTaskCount: results.length,
    appliedCount: results.filter((item) => item.tagging.applied).length,
    results,
    manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
  };
}

async function retryPendingPredecessorDeletes(task) {
  const cleanup = [];
  let pending = (task.handoffs || [])
    .map((handoff, index) => ({ handoff, index }))
    .filter(({ handoff }) => handoff.sourceDeleted === false && !handoff.sourceRetained);
  while (pending.length > 0) {
    let progress = false;
    const retry = [];
    for (const candidate of pending) {
      const { handoff, index } = candidate;
      try {
        const deleted = await deleteThread(
          handoff.sourceThreadId,
          handoff.sourceProvider,
          handoff.sourceModel || null,
        );
        if (!deleted.deleted) {
          retry.push({ ...candidate, reason: "still-present" });
          continue;
        }
        task.handoffs[index] = {
          ...handoff,
          sourceDeleted: true,
          sourceDeletedAt: nowIso(),
        };
        cleanup.push({ threadId: handoff.sourceThreadId, deleted: true });
        progress = true;
      } catch (error) {
        retry.push({
          ...candidate,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!progress) {
      cleanup.push(...retry.map(({ handoff, reason }) => ({
        threadId: handoff.sourceThreadId,
        deleted: false,
        reason,
      })));
      break;
    }
    pending = retry;
  }
  return cleanup;
}

export async function batchHandoff({ targetProvider, onlyTaskId = null, taskIds = null, forceRebuild = false, execute = false } = {}) {
  const plan = await buildBatchHandoffPlan({ targetProvider, onlyTaskId, taskIds, forceRebuild });
  const dryRunPath = path.join(REPORT_DIR, `batch-handoff-dry-run-${timestampForPath()}.json`);
  await atomicWriteJson(dryRunPath, plan);
  if (!execute) return { ...plan, dryRunPath };

  const workingManifest = clone(plan.nextManifest);
  workingManifest.updatedAt = nowIso();
  await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
  const results = [];

  for (const item of plan.items) {
    if (item.action === "skip") {
      results.push({ stableTaskId: item.stableTaskId, sourceThreadId: item.sourceThreadId, status: "skipped", reason: item.reason });
      continue;
    }
    if (item.action === "blocked") {
      const task = item.stableTaskId ? findTask(workingManifest, item.stableTaskId) : null;
      if (task) {
        task.lastError = { at: nowIso(), stage: "dry-run", reason: item.reason, message: item.error || null };
        replaceTask(workingManifest, task);
        workingManifest.updatedAt = nowIso();
        await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
      }
      results.push({ stableTaskId: item.stableTaskId, sourceThreadId: item.sourceThreadId, status: "blocked", reason: item.reason, error: item.error || null });
      continue;
    }
    if (item.action === "noop") {
      const task = findTask(workingManifest, item.stableTaskId);
      let tagging = null;
      if (task) {
        task.lastSeenAt = nowIso();
        task.lastError = null;
        tagging = await applyPairTaggingSafely(task, item.cwd);
        replaceTask(workingManifest, task);
        workingManifest.updatedAt = nowIso();
        await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
      }
      results.push({
        stableTaskId: item.stableTaskId,
        sourceThreadId: item.sourceThreadId,
        targetThreadId: item.targetThreadId || item.pairedTargetThreadId || null,
        status: "noop",
        reason: item.reason,
        sourceProvider: item.sourceProvider || null,
        targetProvider: item.targetProvider || null,
        providerCompat: item.providerCompat || null,
        tagging,
      });
      continue;
    }

    const task = findTask(workingManifest, item.stableTaskId);
    if (!task) {
      results.push({ stableTaskId: item.stableTaskId, sourceThreadId: item.sourceThreadId, status: "failed", error: "manifest task missing" });
      continue;
    }
    try {
      const pairedMode = plan.handoffMode === "paired" && !forceRebuild;
      const existingPairTarget = pairedMode
        ? task.providerThreads?.[item.targetProvider] || null
        : null;
      const result = existingPairTarget && existingPairTarget !== item.sourceThreadId
        ? await syncExistingPair({
            task,
            sourceThreadId: item.sourceThreadId,
            sourceProvider: item.sourceProvider,
            targetProvider: item.targetProvider,
            targetThreadId: existingPairTarget,
            targetModel: item.targetModel,
            targetReasoningEffort: item.targetReasoningEffort,
            onPendingSync: async (pendingSync) => {
              task.pendingSync = pendingSync;
              replaceTask(workingManifest, task);
              workingManifest.updatedAt = nowIso();
              await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
            },
          })
        : await handoffOne({
            execute: true,
            sourceThreadId: item.sourceThreadId,
            targetProvider: item.targetProvider,
            targetModel: item.targetModel,
            targetReasoningEffort: item.targetReasoningEffort,
            targetName: task.explicitName || task.displayName,
            pinTarget: item.isPinned,
          });
      const entry = result.entry;
      if (!entry) throw new Error("交接结果缺少 entry");
      const targetThreadId = entry.targetThreadId;
      task.currentThreadId = result.entry.targetThreadId;
      task.currentProvider = item.targetProvider;
      task.currentModel = item.targetModel;
      const actualTargetReasoningEffort = entry.targetReasoningEffort || item.targetReasoningEffort || null;
      task.currentReasoningEffort = actualTargetReasoningEffort;
      task.canonicalCwd = item.cwd;
      task.providerModels = { ...(task.providerModels || {}), [item.targetProvider]: item.targetModel };
      task.providerReasoningEfforts = {
        ...(task.providerReasoningEfforts || {}),
        ...(actualTargetReasoningEffort
          ? { [item.targetProvider]: actualTargetReasoningEffort }
          : {}),
      };
      task.providerThreads = {
        ...(task.providerThreads || {}),
        [item.sourceProvider]: item.sourceThreadId,
        [item.targetProvider]: targetThreadId,
      };
      task.pairSync = {
        ...(task.pairSync || {}),
        [item.sourceProvider]: {
          threadId: item.sourceThreadId,
          recordCount: result.sourceRecordCount
            ?? result.plan?.source?.flattenedRecordCount
            ?? entry.historyTransfer?.sourceRecordCount
            ?? 0,
        },
        [item.targetProvider]: {
          threadId: targetThreadId,
          recordCount: result.targetRecordCount
            ?? entry.historyTransfer?.targetRecordCount
            ?? 0,
        },
      };
      task.pendingSync = null;
      task.lastSeenAt = nowIso();
      task.lastError = null;
      task.handoffs = [
        ...(task.handoffs || []),
        {
          ...entry,
          sourceDeleted: pairedMode ? false : false,
          sourceRetained: pairedMode,
          pairMode: pairedMode,
        },
      ];
      const tagging = await applyPairTaggingSafely(task, item.cwd);
      replaceTask(workingManifest, task);
      workingManifest.updatedAt = nowIso();
      await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
      let predecessorCleanup = [];
      let sourceDeleted = false;
      if (!pairedMode) {
        const deletedSource = await deleteThread(item.sourceThreadId, item.sourceProvider, item.sourceModel);
        if (!deletedSource.deleted) {
          throw new Error(`目标已创建并写入清单，但源任务 ${item.sourceThreadId} 未能删除`);
        }
        task.handoffs[task.handoffs.length - 1] = {
          ...task.handoffs[task.handoffs.length - 1],
          sourceDeleted: true,
          sourceDeletedAt: nowIso(),
        };
        sourceDeleted = true;
        predecessorCleanup = await retryPendingPredecessorDeletes(task);
        replaceTask(workingManifest, task);
        workingManifest.updatedAt = nowIso();
        await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
      }
      results.push({
        stableTaskId: task.stableTaskId,
        sourceThreadId: item.sourceThreadId,
        targetThreadId: result.entry.targetThreadId,
        status: pairedResultStatus(result),
        reason: result.type === "paired-noop"
          ? (result.reason || "paired-source-cursor-up-to-date")
          : null,
        skippedRecordCount: result.skippedRecordCount || 0,
        skippedProjectionEventCount: result.skippedProjectionEventCount || 0,
        sourceProvider: item.sourceProvider,
        targetProvider: item.targetProvider,
        targetModel: item.targetModel,
        targetReasoningEffort: actualTargetReasoningEffort,
        cwd: item.cwd,
        checks: entry.checks,
        normalization: entry.normalization,
        providerCompat: entry.providerCompat || result.providerCompat || null,
        tagging,
        pinning: entry.pinning,
        sourceDeleted,
        sourceRetained: pairedMode,
        pairMode: pairedMode,
        predecessorCleanup,
        backupRoot: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partial = message.startsWith("配对同步部分写入")
        || message.startsWith("配对同步写入状态无法确认");
      const failureReason = error?.handoffReason
        || (partial ? "partial-sync" : "handoff-failed");
      task.lastError = {
        at: nowIso(),
        stage: "handoff",
        reason: failureReason,
        message,
      };
      replaceTask(workingManifest, task);
      workingManifest.updatedAt = nowIso();
      await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
      results.push({
        stableTaskId: task.stableTaskId,
        sourceThreadId: item.sourceThreadId,
        status: "failed",
        reason: failureReason,
        error: message,
      });
    }
  }

  const summary = {
    handedOff: results.filter((item) => item.status === "handed-off").length,
    noop: results.filter((item) => item.status === "noop").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    failed: results.filter((item) => item.status === "failed").length,
  };

  // 桌面端侧栏只显示 preview 非空的任务；交接生成的端点从没跑过回合，preview
  // 一直是空的，于是看不到也打不开。这里在 Codex 关闭期间把源任务的首条用户
  // 消息文案补写到目标端点（只在目标为空时写，带备份与回读校验）。
  const previewPairs = results
    .filter((item) => item.targetThreadId && item.sourceThreadId && item.sourceThreadId !== item.targetThreadId)
    .map((item) => ({
      sourceThreadId: String(item.sourceThreadId),
      targetThreadId: String(item.targetThreadId),
    }));
  let previewBackfill = null;
  try {
    previewBackfill = await backfillThreadPreviews({
      pairs: previewPairs,
      backupRoot: path.join(REPORT_DIR, "state-backups"),
      execute: true,
    });
  } catch (error) {
    previewBackfill = {
      type: "thread-preview-backfill",
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const run = {
    runAt: nowIso(),
    targetProvider,
    onlyTaskId,
    taskIds,
    forceRebuild,
    requestedTaskIds: plan.requestedTaskIds,
    resolvedTaskIds: plan.resolvedTaskIds,
    unresolvedTaskIds: plan.unresolvedTaskIds,
    dryRunPath,
    summary,
  };
  workingManifest.runs = [...(workingManifest.runs || []), run].slice(-100);
  workingManifest.updatedAt = nowIso();
  await atomicWriteJson(BATCH_HANDOFF_MANIFEST_PATH, workingManifest);
  const resultPath = path.join(REPORT_DIR, `batch-handoff-result-${timestampForPath()}.json`);
  const output = {
    type: summary.failed || summary.blocked ? "batch-handoff-complete-with-errors" : "batch-handoff-complete",
    targetProvider,
    onlyTaskId,
    taskIds,
    forceRebuild,
    requestedTaskIds: plan.requestedTaskIds,
    resolvedTaskIds: plan.resolvedTaskIds,
    unresolvedTaskIds: plan.unresolvedTaskIds,
    dryRunPath,
    resultPath,
    summary,
    previewBackfill,
    results,
    manifestPath: BATCH_HANDOFF_MANIFEST_PATH,
  };
  await atomicWriteJson(resultPath, output);
  return output;
}

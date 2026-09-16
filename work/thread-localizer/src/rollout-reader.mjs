import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_HOME, SESSION_INDEX_PATH } from "./constants.mjs";
import { readJsonl, pathExists } from "./utils.mjs";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

async function walkJsonl(root) {
  const found = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(fullPath);
    }
  }
  await visit(root);
  return found;
}

function storageSegmentId(filePath) {
  const matches = path.basename(filePath).match(UUID_PATTERN) || [];
  return matches.at(-1)?.toLowerCase() || null;
}

async function findHistorySegmentPath(segmentId) {
  const wanted = String(segmentId || "").toLowerCase();
  if (!wanted) return null;
  const roots = [path.join(CODEX_HOME, "sessions"), path.join(CODEX_HOME, "archived_sessions")];
  for (const root of roots) {
    const files = await walkJsonl(root);
    const exact = files.find((filePath) => storageSegmentId(filePath) === wanted);
    if (exact) return exact;
  }
  return null;
}

function parseJsonlText(text, filePath) {
  const records = [];
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push({ line: index + 1, filePath, value: JSON.parse(line) });
    } catch (error) {
      errors.push({
        line: index + 1,
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { records, errors };
}

async function readJsonlPrefix(filePath, endByteOffset = null) {
  const bytes = await fs.readFile(filePath);
  const limited = Number.isInteger(endByteOffset) && endByteOffset >= 0
    ? bytes.subarray(0, Math.min(endByteOffset, bytes.length))
    : bytes;
  return parseJsonlText(limited.toString("utf8"), filePath);
}

export async function readFlattenedRollout(rolloutPath) {
  if (!rolloutPath) throw new Error("找不到待展开的 rollout 路径");
  const visited = new Set();
  const segments = [];

  async function visit(filePath, endByteOffset = null) {
    const visitKey = `${path.resolve(filePath).toLowerCase()}|${endByteOffset ?? "all"}`;
    if (visited.has(visitKey)) throw new Error(`rollout 历史链存在循环: ${filePath}`);
    visited.add(visitKey);

    const parsed = await readJsonlPrefix(filePath, endByteOffset);
    if (parsed.errors.length > 0) {
      return { records: parsed.records, errors: parsed.errors };
    }
    const metadataIndex = parsed.records.findIndex((record) => record.value?.type === "session_meta");
    const metadata = metadataIndex >= 0 ? parsed.records[metadataIndex].value?.payload : null;
    const historyBase = metadata?.history_base || null;
    let inherited = { records: [], errors: [] };
    if (historyBase?.thread_id) {
      const basePath = await findHistorySegmentPath(historyBase.thread_id);
      if (!basePath) {
        throw new Error(`找不到 rollout 历史基段 ${historyBase.thread_id}`);
      }
      inherited = await visit(basePath, historyBase.end_byte_offset ?? null);
    }

    const localRecords = historyBase
      ? parsed.records.filter((_, index) => index !== metadataIndex)
      : parsed.records;
    segments.push({
      path: filePath,
      storageSegmentId: storageSegmentId(filePath),
      endByteOffset,
      inheritedFrom: historyBase?.thread_id || null,
      localRecordCount: localRecords.length,
    });
    return {
      records: [...inherited.records, ...localRecords],
      errors: [...inherited.errors, ...parsed.errors],
    };
  }

  const flattened = await visit(rolloutPath);
  return {
    rolloutPath,
    records: flattened.records,
    errors: flattened.errors,
    segments,
  };
}

export function retargetFlattenedRollout(records, {
  sourceThreadId,
  targetThreadId,
  targetProvider,
  targetCwd,
  targetThreadSource = "user",
}) {
  if (!targetThreadId || !targetProvider || !targetCwd) {
    throw new Error("重建目标 rollout 时缺少任务 ID、提供商或 cwd");
  }
  let metadataSeen = false;
  const rewritten = [];
  for (const record of records) {
    const value = structuredClone(record.value);
    if (value?.type === "session_meta") {
      if (metadataSeen) continue;
      metadataSeen = true;
      value.payload = {
        ...(value.payload || {}),
        session_id: targetThreadId,
        id: targetThreadId,
        cwd: targetCwd,
        model_provider: targetProvider,
        thread_source: targetThreadSource,
        history_mode: "legacy",
      };
      delete value.payload.forked_from_id;
      delete value.payload.forked_from_ordinal_exclusive;
      delete value.payload.history_base;
    } else if (value?.type === "event_msg" && typeof value.payload?.thread_id === "string") {
      value.payload.thread_id = targetThreadId;
    }
    rewritten.push({ ...record, value });
  }
  if (!metadataSeen) throw new Error("源 rollout 缺少 session_meta");
  return rewritten;
}

async function rolloutFromSessionIndex(threadId) {
  if (!(await pathExists(SESSION_INDEX_PATH))) return null;
  const { records } = await readJsonl(SESSION_INDEX_PATH);
  const match = records.map((record) => record.value).find((value) => value?.id === threadId);
  if (match?.rollout_path && await pathExists(match.rollout_path)) return match.rollout_path;
  return null;
}

export async function findRolloutPath(threadId) {
  if (!threadId) throw new Error("查找 rollout 时必须提供任务 ID");
  const indexed = await rolloutFromSessionIndex(threadId);
  if (indexed) return indexed;
  const roots = [path.join(CODEX_HOME, "sessions"), path.join(CODEX_HOME, "archived_sessions")];
  for (const root of roots) {
    const files = await walkJsonl(root);
    const matches = files.filter((filePath) => path.basename(filePath).includes(threadId));
    if (matches.length) {
      matches.sort();
      return matches[0];
    }
  }
  return null;
}


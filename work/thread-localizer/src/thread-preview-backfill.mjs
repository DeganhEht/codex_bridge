import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CODEX_HOME } from "./constants.mjs";
import { ensureDir, nowIso, pathExists, timestampForPath } from "./utils.mjs";

function normalizePairs(value) {
  const pairs = [];
  for (const item of Array.isArray(value) ? value : []) {
    const sourceThreadId = String(item?.sourceThreadId || item?.source || "").trim();
    const targetThreadId = String(item?.targetThreadId || item?.target || "").trim();
    if (!sourceThreadId || !targetThreadId || sourceThreadId === targetThreadId) continue;
    pairs.push({ sourceThreadId, targetThreadId });
  }
  return pairs;
}

function firstPreviewText(row) {
  return String(row?.preview || "").trim()
    || String(row?.first_user_message || "").trim()
    || String(row?.title || "").trim();
}

async function backupStateDatabase(dbPath, backupRoot) {
  if (!backupRoot) return null;
  const directory = path.join(backupRoot, `state-backup-${timestampForPath()}`);
  await ensureDir(directory);
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${dbPath}${suffix}`;
    if (!(await pathExists(source))) continue;
    await fs.copyFile(source, path.join(directory, path.basename(source)));
  }
  return directory;
}

async function restoreStateDatabase(dbPath, backupDirectory) {
  if (!backupDirectory) return false;
  for (const suffix of ["", "-wal", "-shm"]) {
    const backup = path.join(backupDirectory, `${path.basename(dbPath)}${suffix}`);
    if (!(await pathExists(backup))) continue;
    await fs.copyFile(backup, `${dbPath}${suffix}`);
  }
  return true;
}

/**
 * 桌面端侧栏走的是只读 state DB 的快速列表：`preview` 为空的任务不会出现在
 * 侧栏里，而没有官方 API 可以写这一列。对“只注入历史、从未跑过回合”的交接端点，
 * 这里把源任务的第一条用户消息文案补写进目标端点的 preview/first_user_message/title，
 * 只在目标列为空时写入，写前备份整库，写完回读校验，失败则从备份恢复。
 */
export async function backfillThreadPreviews({
  pairs = [],
  dbPath = path.join(CODEX_HOME, "state_5.sqlite"),
  backupRoot = null,
  execute = false,
} = {}) {
  const requested = normalizePairs(pairs);
  const result = {
    type: "thread-preview-backfill",
    at: nowIso(),
    dbPath,
    execute,
    updateCount: 0,
    plan: [],
    backupDirectory: null,
    verified: null,
    restored: false,
  };
  if (requested.length === 0) {
    return { ...result, status: "noop", reason: "no-pairs" };
  }
  if (!(await pathExists(dbPath))) {
    return { ...result, status: "blocked", reason: "state-db-missing" };
  }

  const reader = new DatabaseSync(dbPath, { readOnly: true });
  let plan;
  try {
    plan = requested.map((pair) => {
      const source = reader.prepare(
        "SELECT preview, title, first_user_message FROM threads WHERE id = ?",
      ).get(pair.sourceThreadId) || null;
      const target = reader.prepare(
        "SELECT preview, title, first_user_message FROM threads WHERE id = ?",
      ).get(pair.targetThreadId) || null;
      if (!source) return { ...pair, action: "skip", reason: "source-row-missing" };
      if (!target) return { ...pair, action: "skip", reason: "target-row-missing" };
      const preview = firstPreviewText(source);
      if (!preview) return { ...pair, action: "skip", reason: "source-preview-empty" };
      if (String(target.preview || "").trim()) {
        return { ...pair, action: "skip", reason: "target-preview-present" };
      }
      return {
        ...pair,
        action: "update",
        preview,
        firstUserMessage: String(source.first_user_message || "").trim() || preview,
        title: String(source.title || "").trim() || preview,
      };
    });
  } finally {
    reader.close();
  }

  const updates = plan.filter((entry) => entry.action === "update");
  result.plan = plan;
  result.updateCount = updates.length;
  if (!execute) return { ...result, status: "dry-run" };
  if (updates.length === 0) return { ...result, status: "noop", reason: "nothing-to-update" };

  result.backupDirectory = await backupStateDatabase(dbPath, backupRoot);

  const writer = new DatabaseSync(dbPath);
  writer.exec("PRAGMA busy_timeout = 5000");
  try {
    writer.exec("BEGIN IMMEDIATE");
    try {
      const statement = writer.prepare(
        "UPDATE threads SET preview = ?, first_user_message = ?, title = ? "
        + "WHERE id = ? AND (preview IS NULL OR preview = '')",
      );
      for (const update of updates) {
        statement.run(update.preview, update.firstUserMessage, update.title, update.targetThreadId);
      }
      writer.exec("COMMIT");
    } catch (error) {
      writer.exec("ROLLBACK");
      throw error;
    }
  } finally {
    writer.close();
  }

  const verifier = new DatabaseSync(dbPath, { readOnly: true });
  const mismatches = [];
  try {
    for (const update of updates) {
      const row = verifier.prepare("SELECT preview FROM threads WHERE id = ?").get(update.targetThreadId);
      if (String(row?.preview || "") !== update.preview) {
        mismatches.push({ targetThreadId: update.targetThreadId, expected: update.preview, actual: row?.preview ?? null });
      }
    }
  } finally {
    verifier.close();
  }
  result.verified = mismatches.length === 0;
  if (mismatches.length > 0) {
    result.restored = await restoreStateDatabase(dbPath, result.backupDirectory);
    return { ...result, status: "verification-failed", mismatches };
  }
  return { ...result, status: "applied" };
}

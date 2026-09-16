import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { backfillThreadPreviews } from "../src/thread-preview-backfill.mjs";

async function createFixture(context, rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-preview-backfill-"));
  context.after(async () => {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const dbPath = path.join(directory, "state_5.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, preview TEXT, title TEXT, first_user_message TEXT, updated_at INTEGER)");
  const insert = db.prepare("INSERT INTO threads (id, preview, title, first_user_message, updated_at) VALUES (?, ?, ?, ?, ?)");
  for (const row of rows) {
    insert.run(row.id, row.preview ?? "", row.title ?? "", row.firstUserMessage ?? "", row.updatedAt ?? 1);
  }
  db.close();
  return { directory, dbPath };
}

function readRow(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT id, preview, title, first_user_message, updated_at FROM threads WHERE id = ?").get(id);
  } finally {
    db.close();
  }
}

const source = "01a0720b-0988-77a0-994c-4a2ab19581a8";
const target = "01a0a924-958f-7ec3-9b2a-96fa0e039779";
const untouched = "01a0a5bf-0ce9-7b60-9ca2-d9f51ca0fcda";

test("dry-run reports the planned preview write without touching the database", async (context) => {
  const { dbPath } = await createFixture(context, [
    { id: source, preview: "审阅我的 AGENTS.md", title: "审阅我的 AGENTS.md", firstUserMessage: "审阅我的 AGENTS.md" },
    { id: target, updatedAt: 7 },
    { id: untouched, preview: "别的任务", updatedAt: 9 },
  ]);
  const result = await backfillThreadPreviews({ pairs: [{ sourceThreadId: source, targetThreadId: target }], dbPath });
  assert.equal(result.status, "dry-run");
  assert.equal(result.updateCount, 1);
  assert.equal(readRow(dbPath, target).preview, "");
});

test("writes preview, first_user_message and title only for empty targets", async (context) => {
  const { dbPath, directory } = await createFixture(context, [
    { id: source, preview: "审阅我的 AGENTS.md", title: "审阅我的 AGENTS.md", firstUserMessage: "审阅我的 AGENTS.md" },
    { id: target, updatedAt: 7 },
    { id: untouched, preview: "别的任务", title: "别的任务", firstUserMessage: "别的任务", updatedAt: 9 },
  ]);
  const backupRoot = path.join(directory, "reports");
  const result = await backfillThreadPreviews({
    pairs: [
      { sourceThreadId: source, targetThreadId: target },
      { sourceThreadId: source, targetThreadId: untouched },
    ],
    dbPath,
    backupRoot,
    execute: true,
  });
  assert.equal(result.status, "applied");
  assert.equal(result.verified, true);
  assert.equal(result.restored, false);
  assert.ok(result.backupDirectory, "写入前必须生成备份目录");

  const written = readRow(dbPath, target);
  assert.equal(written.preview, "审阅我的 AGENTS.md");
  assert.equal(written.first_user_message, "审阅我的 AGENTS.md");
  assert.equal(written.title, "审阅我的 AGENTS.md");
  assert.equal(written.updated_at, 7, "不应改动 updated_at");

  const other = readRow(dbPath, untouched);
  assert.equal(other.preview, "别的任务", "已有 preview 的目标不得被覆盖");

  const second = await backfillThreadPreviews({ pairs: [{ sourceThreadId: source, targetThreadId: target }], dbPath, execute: true });
  assert.equal(second.status, "noop");
  assert.equal(second.reason, "nothing-to-update");
});

test("skips pairs whose source has no preview text", async (context) => {
  const { dbPath } = await createFixture(context, [
    { id: source },
    { id: target },
  ]);
  const result = await backfillThreadPreviews({ pairs: [{ sourceThreadId: source, targetThreadId: target }], dbPath, execute: true });
  assert.equal(result.status, "noop");
  assert.deepEqual(result.plan.map((entry) => entry.reason), ["source-preview-empty"]);
  assert.equal(readRow(dbPath, target).preview, "");
});

test("reports missing rows instead of failing the handoff", async (context) => {
  const { dbPath } = await createFixture(context, [
    { id: target },
  ]);
  const result = await backfillThreadPreviews({ pairs: [{ sourceThreadId: source, targetThreadId: target }], dbPath, execute: true });
  assert.equal(result.status, "noop");
  assert.deepEqual(result.plan.map((entry) => entry.reason), ["source-row-missing"]);
  const missingTarget = await backfillThreadPreviews({ pairs: [{ sourceThreadId: target, targetThreadId: source }], dbPath, execute: true });
  assert.deepEqual(missingTarget.plan.map((entry) => entry.reason), ["target-row-missing"]);
});

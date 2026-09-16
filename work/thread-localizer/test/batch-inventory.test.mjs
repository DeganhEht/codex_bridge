import assert from "node:assert/strict";
import test from "node:test";

import { dedupeThreadsById, normalizeTaskIds } from "../src/batch-handoff-engine.mjs";

test("task discovery keeps only the newest row for each thread id", () => {
  const result = dedupeThreadsById([
    { id: "same", updatedAt: 10, name: "old" },
    { id: "other", updatedAt: 15, name: "other" },
    { id: "same", updatedAt: 20, name: "new" },
  ]);
  assert.deepEqual(result, [
    { id: "same", updatedAt: 20, name: "new" },
    { id: "other", updatedAt: 15, name: "other" },
  ]);
});

test("task id selection deduplicates comma lists and preserves order", () => {
  assert.deepEqual(
    normalizeTaskIds({ taskIds: "a,b,a", onlyTaskId: "c" }),
    ["a", "b", "c"],
  );
});

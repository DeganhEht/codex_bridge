import assert from "node:assert/strict";
import test from "node:test";

import {
  findContiguousBlockOccurrences,
  repeatedTailInfo,
} from "../src/pair-sync-signatures.mjs";

function record(type, ordinal, payload = {}) {
  return { value: { type, ordinal, timestamp: `t-${ordinal}`, payload } };
}

test("ignores rollout timestamp and ordinal while finding one or duplicate blocks", () => {
  const block = [record("response_item", 1, { id: "a" }), record("event_msg", 2, { type: "task_started" })];
  const one = [record("base", 0), ...block.map((item, index) => record(item.value.type, index + 10, item.value.payload))];
  assert.deepEqual(findContiguousBlockOccurrences(one, block), [1]);

  const duplicate = [...one, ...block.map((item, index) => record(item.value.type, index + 20, item.value.payload))];
  assert.deepEqual(findContiguousBlockOccurrences(duplicate, block), [1, 3]);
  const info = repeatedTailInfo(duplicate, 0);
  assert.equal(info, null);

  const repeatedTail = [record("base", 0), ...block, ...block.map((item, index) => record(item.value.type, index + 20, item.value.payload))];
  const repeated = repeatedTailInfo(repeatedTail, 1);
  assert.equal(repeated.copies, 2);
  assert.equal(repeated.blockRecordCount, 2);
});

test("ignores the app-server's null reasoning content default", () => {
  const source = record("response_item", 1, {
    type: "reasoning",
    summary: [{ type: "summary_text", text: "x" }],
    encrypted_content: null,
  });
  const persisted = record("response_item", 99, {
    type: "reasoning",
    summary: [{ type: "summary_text", text: "x" }],
    content: null,
    encrypted_content: null,
  });
  assert.deepEqual(findContiguousBlockOccurrences([persisted], [source]), [0]);
});

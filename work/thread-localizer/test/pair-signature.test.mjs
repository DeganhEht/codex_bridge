import assert from "node:assert/strict";
import test from "node:test";

import {
  findContiguousBlockOccurrences,
  recordsFingerprint,
  repeatedTailInfo,
  summarizeBlockDifferences,
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

test("ignores record envelope fields the app-server rebuilds, including metadata", () => {
  const source = {
    value: {
      type: "response_item",
      timestamp: "t-1",
      ordinal: 11,
      metadata: { client_authored: false, fallback_token_limit_override: 12000 },
      payload: {
        type: "function_call_output",
        id: "fco_1",
        call_id: "call_1",
        output: [{ type: "input_text", text: "Wall time: 0.0231 seconds" }],
      },
    },
  };
  const persisted = {
    value: {
      type: "response_item",
      timestamp: "t-99",
      ordinal: 4242,
      payload: {
        type: "function_call_output",
        id: "fco_1",
        call_id: "call_1",
        output: [{ type: "input_text", text: "Wall time: 0.0231 seconds" }],
      },
    },
  };
  assert.equal(recordsFingerprint([source]), recordsFingerprint([persisted]));
  assert.deepEqual(findContiguousBlockOccurrences([persisted], [source]), [0]);
});

test("treats nested null payload values as missing", () => {
  const source = record("response_item", 1, {
    type: "message",
    role: "assistant",
    metadata: { hint: null },
    content: [{ type: "output_text", text: "x" }],
  });
  const persisted = record("response_item", 9, {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "x" }],
  });
  assert.deepEqual(findContiguousBlockOccurrences([persisted], [source]), [0]);
});

test("still rejects injected content that really differs, and explains where", () => {
  const source = record("response_item", 1, {
    type: "function_call_output",
    call_id: "call_1",
    output: [{ type: "input_text", text: "ok" }],
  });
  const tampered = record("response_item", 2, {
    type: "function_call_output",
    call_id: "call_1",
    output: [{ type: "input_text", text: "different" }],
  });
  assert.deepEqual(findContiguousBlockOccurrences([tampered], [source]), []);
  const summary = summarizeBlockDifferences([tampered], [source]);
  assert.equal(summary.comparedRecords, 1);
  assert.equal(summary.mismatchedRecords, 1);
  assert.equal(summary.lengthDelta, 0);
  assert.deepEqual(summary.fields.map((field) => field.path), ["payload.output[0].text"]);
  assert.deepEqual(summary.sampleIndexes, [0]);
});

test("still detects duplicated blocks when one copy carries extra envelope fields", () => {
  const block = record("response_item", 1, { id: "a" });
  const base = record("base", 0);
  const copyWithEnvelope = { value: { ...block.value, metadata: { client_authored: false } } };
  const info = repeatedTailInfo([base, block, copyWithEnvelope], 1);
  assert.equal(info.copies, 2);
  assert.equal(info.blockRecordCount, 1);
});

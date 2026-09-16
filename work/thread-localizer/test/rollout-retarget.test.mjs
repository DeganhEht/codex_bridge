import assert from "node:assert/strict";
import test from "node:test";

import { retargetFlattenedRollout } from "../src/rollout-reader.mjs";
import { countVisibleMessages } from "../src/utils.mjs";

test("retargeted history is independent and rewrites event ownership", () => {
  const records = [
    {
      line: 1,
      value: {
        type: "session_meta",
        payload: {
          id: "source",
          session_id: "source",
          model_provider: "deepseek",
          history_mode: "paginated",
          history_base: { thread_id: "base", end_ordinal_exclusive: 4 },
          forked_from_id: "parent",
          forked_from_ordinal_exclusive: 4,
        },
      },
    },
    { line: 2, value: { type: "event_msg", payload: { type: "item_completed", thread_id: "ancestor" } } },
    { line: 3, value: { type: "session_meta", payload: { id: "later-segment" } } },
  ];

  const rewritten = retargetFlattenedRollout(records, {
    sourceThreadId: "source",
    targetThreadId: "target",
    targetProvider: "openai",
    targetCwd: "C:\\work",
  });

  assert.equal(rewritten.length, 2);
  assert.deepEqual(rewritten[0].value.payload, {
    id: "target",
    session_id: "target",
    model_provider: "openai",
    history_mode: "legacy",
    cwd: "C:\\work",
    thread_source: "user",
  });
  assert.equal(rewritten[1].value.payload.thread_id, "target");
  assert.equal(records[0].value.payload.forked_from_id, "parent");
});

test("visible message counting supports paginated item entries", () => {
  assert.equal(countVisibleMessages([
    { turnId: "one", item: { type: "userMessage" } },
    { turnId: "one", item: { type: "agentMessage" } },
    { turnId: "one", item: { type: "UserMessage" } },
    { turnId: "one", item: { type: "AgentMessage" } },
    { turnId: "one", item: { type: "reasoning" } },
    { type: "message", role: "assistant" },
  ]), 5);
});

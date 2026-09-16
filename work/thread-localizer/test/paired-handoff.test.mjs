import assert from "node:assert/strict";
import test from "node:test";

import { normalizedPairDelta, resumeAndWaitForPairTarget } from "../src/paired-handoff-engine.mjs";
import { pairedResultStatus } from "../src/batch-handoff-engine.mjs";

test("thread/read does not load a stored target; resume and loaded-list are required before inject", async () => {
  const calls = [];
  let loaded = false;
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/read") {
        return { thread: { id: "target", status: { type: "notLoaded" } } };
      }
      if (method === "thread/resume") {
        loaded = true;
        return {};
      }
      if (method === "thread/loaded/list") {
        return { data: loaded ? ["target"] : [] };
      }
      if (method === "thread/inject_items") {
        if (!loaded) throw new Error("thread not found: target");
        return {};
      }
      return {};
    },
  };
  await client.request("thread/read", { threadId: "target" });
  await assert.rejects(
    client.request("thread/inject_items", { threadId: "target", items: [{ type: "message" }] }),
    /thread not found/,
  );

  await resumeAndWaitForPairTarget({
    client,
    targetThreadId: "target",
    resumeParams: { threadId: "target" },
    sleep: async () => {},
  });
  await client.request("thread/inject_items", {
    threadId: "target",
    items: [{ type: "message", role: "assistant", content: "ok" }],
  });

  assert.deepEqual(calls.map((call) => call.method), [
    "thread/read",
    "thread/inject_items",
    "thread/resume",
    "thread/loaded/list",
    "thread/inject_items",
  ]);
});

test("waits for a delayed loaded-list state instead of sleeping once", async () => {
  let polls = 0;
  let sleeps = 0;
  const client = {
    async request(method) {
      if (method === "thread/resume") return {};
      if (method === "thread/loaded/list") {
        polls += 1;
        return { data: polls >= 3 ? ["target"] : [] };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  const result = await resumeAndWaitForPairTarget({
    client,
    targetThreadId: "target",
    resumeParams: { threadId: "target" },
    timeoutMs: 100,
    pollIntervalMs: 1,
    sleep: async () => { sleeps += 1; },
  });

  assert.deepEqual(result, { threadId: "target", loaded: true });
  assert.equal(polls, 3);
  assert.equal(sleeps, 2);
});

test("reports a bounded load timeout", async () => {
  const client = {
    async request(method) {
      if (method === "thread/resume") return {};
      if (method === "thread/loaded/list") return { data: [] };
      throw new Error(`unexpected method: ${method}`);
    },
  };

  await assert.rejects(
    resumeAndWaitForPairTarget({
      client,
      targetThreadId: "target",
      resumeParams: { threadId: "target" },
      timeoutMs: 0,
      sleep: async () => {},
    }),
    (error) => error.handoffReason === "paired-target-load-timeout",
  );
});

test("paired no-op is reported separately from an actual handoff", () => {
  assert.equal(pairedResultStatus({ type: "paired-noop" }), "noop");
  assert.equal(pairedResultStatus({ type: "paired-synced" }), "handed-off");
});

test("paired deepseek delta drops orphan tool outputs before injection", () => {
  const records = [
    { value: { type: "response_item", payload: { type: "function_call", id: "call-1", call_id: "call-1" } } },
    { value: { type: "response_item", payload: { type: "function_call_output", id: "fco-1", call_id: "call-1", output: "ok" } } },
    { value: { type: "response_item", payload: { type: "function_call_output", id: "fco-orphan", output: "delegation" } } },
  ];

  const deepseekDelta = normalizedPairDelta(records, "deepseek");
  assert.equal(deepseekDelta.droppedOrphanToolOutputCount, 1);
  assert.deepEqual(deepseekDelta.droppedOrphanToolOutputs.map((item) => item.id), ["fco-orphan"]);
  assert.deepEqual(
    deepseekDelta.records.map((item) => item.value.payload.id),
    ["call-1", "fco-1"],
  );

  const openaiDelta = normalizedPairDelta(records, "openai");
  assert.equal(openaiDelta.droppedOrphanToolOutputCount, 0);
  assert.equal(openaiDelta.records.length, 3);
});

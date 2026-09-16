import assert from "node:assert/strict";
import test from "node:test";
import {
  clearThreadBoundEncryptedReasoning,
  normalizeOpenAIRolloutRecords,
} from "../src/openai-rollout-normalizer.mjs";

function record(type, payload) {
  return { line: 1, value: { type, payload } };
}

test("normalizes DeepSeek reasoning and eight linked web search calls for OpenAI", () => {
  const callIds = Array.from({ length: 8 }, (_, index) => `call_0${index}_search`);
  const records = [
    record("response_item", { type: "reasoning", content: [{ type: "reasoning_text", text: "thinking" }] }),
    record("response_item", { type: "reasoning", content: [] }),
    ...callIds.flatMap((id, index) => [
      record("event_msg", { type: "web_search_end", call_id: id }),
      record("response_item", {
        type: "web_search_call",
        id,
        status: index % 3 === 0 ? "failed" : "completed",
        action: { type: index === 0 ? "search" : "open_page" },
      }),
    ]),
    record("response_item", { type: "web_search_call", id: "ws_native", status: "completed" }),
    record("response_item", { type: "function_call", id: "call_function", call_id: "call_function_ref" }),
    record("event_msg", { type: "tool_end", call_id: "call_function_ref" }),
  ];

  const result = normalizeOpenAIRolloutRecords(records);

  assert.equal(result.normalizedReasoningCount, 2);
  assert.equal(result.normalizedWebSearchCallIdCount, 8);
  assert.equal(result.normalizedWebSearchEventReferenceCount, 8);
  assert.equal(result.totalNormalizedCount, 18);
  assert.deepEqual(
    result.records.filter((item) => item.value.payload?.type === "web_search_call")
      .map((item) => item.value.payload.id),
    [...callIds.map((id) => id.replace(/^call_/, "ws_")), "ws_native"],
  );
  assert.deepEqual(
    result.records.filter((item) => item.value.payload?.type === "web_search_end")
      .map((item) => item.value.payload.call_id),
    callIds.map((id) => id.replace(/^call_/, "ws_")),
  );
  assert.equal(result.records[0].value.payload.content, null);
  assert.equal(result.records[1].value.payload.content, null);
  assert.equal(records[0].value.payload.content[0].text, "thinking");
  assert.equal(result.records.at(-2).value.payload.id, "call_function");
  assert.equal(result.records.at(-1).value.payload.call_id, "call_function_ref");
});

test("rejects web search IDs that collide after conversion", () => {
  const records = [
    record("response_item", { type: "web_search_call", id: "call_same" }),
    record("response_item", { type: "web_search_call", id: "ws_same" }),
  ];
  assert.throws(
    () => normalizeOpenAIRolloutRecords(records),
    /转换后冲突/,
  );
});

test("rejects missing web search IDs instead of silently handing off", () => {
  const records = [record("response_item", { type: "web_search_call", id: "" })];
  assert.throws(
    () => normalizeOpenAIRolloutRecords(records),
    /缺少可转换的字符串 ID/,
  );
});

test("clears thread-bound encrypted reasoning without changing summaries", () => {
  const records = [record("response_item", {
    type: "reasoning",
    summary: [{ type: "summary_text", text: "kept" }],
    content: null,
    encrypted_content: "old-thread-ciphertext",
  })];
  const result = clearThreadBoundEncryptedReasoning(records);
  assert.equal(result.clearedEncryptedReasoningCount, 1);
  assert.equal(result.records[0].value.payload.encrypted_content, null);
  assert.deepEqual(result.records[0].value.payload.summary, [{ type: "summary_text", text: "kept" }]);
  assert.equal(records[0].value.payload.encrypted_content, "old-thread-ciphertext");
});

test("drops tool outputs without call_id only when the target is DeepSeek", () => {
  const records = [
    record("response_item", { type: "function_call", id: "call-1", call_id: "call-1", name: "exec_command", arguments: "{}" }),
    record("response_item", { type: "function_call_output", id: "fco-1", call_id: "call-1", output: "ok" }),
    record("response_item", { type: "function_call_output", id: "fco-orphan", name: "send_message_to_thread", output: "delegation" }),
    record("response_item", { type: "custom_tool_call_output", id: "cto-orphan", name: "apply_patch", output: "done" }),
  ];

  const deepseek = normalizeOpenAIRolloutRecords(records, { targetProvider: "deepseek" });
  assert.equal(deepseek.droppedOrphanToolOutputCount, 2);
  assert.deepEqual(
    deepseek.droppedOrphanToolOutputs.map((item) => [item.id, item.type]),
    [["fco-orphan", "function_call_output"], ["cto-orphan", "custom_tool_call_output"]],
  );
  assert.equal(deepseek.records.length, 2);
  assert.equal(records.length, 4, "原始历史不能被就地修改");

  const openai = normalizeOpenAIRolloutRecords(records, { targetProvider: "openai" });
  assert.equal(openai.droppedOrphanToolOutputCount, 0);
  assert.equal(openai.records.length, 4);
});

test("keeps DeepSeek tool outputs whose call lives in an earlier delta", () => {
  const records = [
    record("response_item", { type: "function_call_output", id: "fco-2", call_id: "call-earlier", output: "ok" }),
  ];
  const result = normalizeOpenAIRolloutRecords(records, { targetProvider: "deepseek" });
  assert.equal(result.droppedOrphanToolOutputCount, 0);
  assert.equal(result.records.length, 1);
});

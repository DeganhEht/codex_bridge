import assert from "node:assert/strict";
import test from "node:test";

import {
  providerDisplayTag,
  resolveBaseDisplayName,
  stripProviderTag,
  taggedThreadName,
} from "../src/pair-tagging.mjs";

test("provider tags are prefixed exactly once", () => {
  assert.equal(providerDisplayTag("openai"), "[GPT]");
  assert.equal(providerDisplayTag("deepseek"), "[DeepSeek]");
  assert.equal(taggedThreadName("openai", "了解 Codex 使用 DeepSeek API"), "[GPT] 了解 Codex 使用 DeepSeek API");
  assert.equal(taggedThreadName("deepseek", "了解 Codex 使用 DeepSeek API"), "[DeepSeek] 了解 Codex 使用 DeepSeek API");
});

test("existing tags are stripped without touching ordinary names", () => {
  assert.equal(stripProviderTag("[GPT] 澄清 1 的含义"), "澄清 1 的含义");
  assert.equal(stripProviderTag("[DeepSeek] 澄清 1 的含义"), "澄清 1 的含义");
  assert.equal(stripProviderTag("[GPT] [DeepSeek] 澄清 1 的含义"), "澄清 1 的含义");
  assert.equal(stripProviderTag("澄清 1 的含义"), "澄清 1 的含义");
  assert.equal(stripProviderTag(null), "");
  assert.equal(stripProviderTag("   "), "");
});

test("base name keeps the newest manual rename and ignores empty candidates", () => {
  assert.equal(
    resolveBaseDisplayName(["[DeepSeek] 用户改过的名字", "[GPT] 旧名字"]),
    "用户改过的名字",
  );
  assert.equal(resolveBaseDisplayName([null, "", "   ", "[GPT] 兜底名字"]), "兜底名字");
  assert.equal(resolveBaseDisplayName([]), null);
});

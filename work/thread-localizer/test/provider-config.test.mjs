import assert from "node:assert/strict";
import test from "node:test";

import {
  appServerProviderOverrides,
  resolveTargetModel,
  resolveTargetReasoningEffort,
} from "../src/provider-config.mjs";

const settings = {
  managedProviders: {
    deepseek: {
      activeModel: "deepseek-v4-pro",
      modelAliases: {
        "deepseek-flash": "gpt-5.6-terra",
        "deepseek-v4-pro": "gpt-5.6-sol",
      },
      modelPolicy: "preserve-existing",
      reasoningEffort: "max",
      reasoningPolicy: "preserve-existing",
    },
  },
};

test("new DeepSeek tasks default to the UI-compatible Pro alias plus Max", () => {
  assert.equal(resolveTargetModel(settings, "deepseek", {}), "gpt-5.6-sol");
  assert.equal(resolveTargetReasoningEffort(settings, "deepseek", {}), "max");
});

test("DeepSeek handoff restores the task's last model and effort", () => {
  const task = {
      providerModels: { deepseek: "deepseek-flash" },
    providerReasoningEfforts: { deepseek: "low" },
  };
  assert.equal(resolveTargetModel(settings, "deepseek", task), "gpt-5.6-terra");
  assert.equal(resolveTargetReasoningEffort(settings, "deepseek", task), "low");
});

test("app-server receives sticky model and reasoning overrides", () => {
  assert.deepEqual(
    appServerProviderOverrides("deepseek", "gpt-5.6-sol", "max"),
    {
      model_provider: "deepseek",
      model: "gpt-5.6-sol",
      model_reasoning_effort: "max",
      forced_login_method: "api",
    },
  );
});

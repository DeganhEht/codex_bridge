import { createAppServerClient } from "./appserver-client.mjs";
import { appServerProviderOverrides, normalizeCwd } from "./provider-config.mjs";
import { stateRow } from "./handoff-engine.mjs";
import { resumeAndWaitForPairTarget } from "./paired-handoff-engine.mjs";

export const PROVIDER_DISPLAY_TAGS = {
  openai: "[GPT]",
  deepseek: "[DeepSeek]",
};

const PROVIDER_TAG_PATTERN = /^\s*\[(?:GPT|DeepSeek)\]\s*/i;

export function providerDisplayTag(provider) {
  return PROVIDER_DISPLAY_TAGS[provider] || `[${provider}]`;
}

export function stripProviderTag(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  while (PROVIDER_TAG_PATTERN.test(text)) {
    text = text.replace(PROVIDER_TAG_PATTERN, "").trim();
  }
  return text;
}

export function taggedThreadName(provider, baseName) {
  return `${providerDisplayTag(provider)} ${baseName}`;
}

export function resolveBaseDisplayName(candidates) {
  for (const candidate of candidates || []) {
    const stripped = stripProviderTag(candidate);
    if (stripped) return stripped;
  }
  return null;
}

function isThreadNotLoadedError(error) {
  const text = String(error?.message || error || "");
  return /not loaded|notloaded|not found|未加载|未找到|找不到/.test(text);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 用官方的 thread/name/set 给端点改名；任务未加载时先 resume 再重试，
 * 最后回读 state DB 校验，避免出现“报告成功但侧栏没变”的假成功。
 */
export async function setThreadName({
  threadId,
  provider,
  model = null,
  cwd = null,
  name,
  verifyAttempts = 10,
  verifyIntervalMs = 150,
}) {
  if (!threadId) throw new Error("改名需要 threadId");
  if (!name) throw new Error("改名需要目标名称");
  const workingDirectory = normalizeCwd(cwd) || process.cwd();
  const client = await createAppServerClient({
    cwd: workingDirectory,
    configOverrides: appServerProviderOverrides(provider, model),
  });
  let resumed = false;
  try {
    try {
      await client.request("thread/name/set", { threadId, name });
    } catch (error) {
      if (!isThreadNotLoadedError(error)) throw error;
      const resumeParams = {
        threadId,
        cwd: workingDirectory,
        modelProvider: provider,
        excludeTurns: false,
      };
      if (model) resumeParams.model = model;
      await resumeAndWaitForPairTarget({ client, targetThreadId: threadId, resumeParams });
      resumed = true;
      await client.request("thread/name/set", { threadId, name });
    }
  } finally {
    await client.close();
  }

  for (let attempt = 0; attempt < verifyAttempts; attempt += 1) {
    if ((stateRow(threadId)?.name || null) === name) {
      return { threadId, name, applied: true, resumed, verified: true, changed: true };
    }
    await wait(verifyIntervalMs);
  }
  return {
    threadId,
    name,
    applied: false,
    resumed,
    verified: false,
    changed: true,
    reason: "name-verification-failed",
  };
}

export async function ensurePairTags({
  openaiThreadId = null,
  deepseekThreadId = null,
  fallbackName = null,
  cwd = null,
}) {
  const openaiRow = openaiThreadId ? stateRow(openaiThreadId) : null;
  const deepseekRow = deepseekThreadId ? stateRow(deepseekThreadId) : null;
  const baseName = resolveBaseDisplayName([
    openaiRow?.name,
    deepseekRow?.name,
    openaiRow?.title,
    deepseekRow?.title,
    fallbackName,
  ]);
  if (!baseName) {
    return { applied: false, reason: "base-name-missing", baseName: null, tags: {} };
  }

  const endpoints = [
    ["openai", openaiThreadId, openaiRow],
    ["deepseek", deepseekThreadId, deepseekRow],
  ].filter(([, threadId]) => Boolean(threadId));

  const tags = {};
  for (const [provider, threadId, row] of endpoints) {
    const desired = taggedThreadName(provider, baseName);
    if ((row?.name || null) === desired) {
      tags[provider] = { threadId, name: desired, applied: true, changed: false, verified: true };
      continue;
    }
    try {
      const outcome = await setThreadName({
        threadId,
        provider,
        model: row?.model || null,
        cwd: cwd || row?.cwd || null,
        name: desired,
      });
      tags[provider] = outcome;
    } catch (error) {
      tags[provider] = {
        threadId,
        name: desired,
        applied: false,
        changed: true,
        verified: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    applied: Object.values(tags).every((entry) => entry.applied),
    baseName,
    tags,
  };
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const toolRoot = path.join(repoRoot, "work", "thread-localizer");
const testCwd = toolRoot;
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-thread-load-"));
let cleanupPending = false;

try {
  process.env.CODEX_HOME = tempHome;
  await fs.writeFile(path.join(tempHome, "config.toml"), [
    'model = "gpt-5.6-sol"',
    'model_provider = "openai"',
    'forced_login_method = "chatgpt"',
    "",
    "[model_providers.deepseek]",
    'name = "DeepSeek"',
    'base_url = "http://127.0.0.1:9/"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "",
  ].join("\n"), "utf8");
  const { createAppServerClient, findCodexBinary } = await import(
    pathToFileURL(path.join(toolRoot, "src", "appserver-client.mjs")),
  );
  const { resumeAndWaitForPairTarget } = await import(
    pathToFileURL(path.join(toolRoot, "src", "paired-handoff-engine.mjs")),
  );
  const { readFlattenedRollout } = await import(
    pathToFileURL(path.join(toolRoot, "src", "rollout-reader.mjs")),
  );
  const { setThreadName, stripProviderTag, taggedThreadName } = await import(
    pathToFileURL(path.join(toolRoot, "src", "pair-tagging.mjs")),
  );
  const { ensurePairTags } = await import(
    pathToFileURL(path.join(toolRoot, "src", "pair-tagging.mjs")),
  );
  const { stateRow } = await import(
    pathToFileURL(path.join(toolRoot, "src", "handoff-engine.mjs")),
  );
  const { appendProjectionEvents } = await import(
    pathToFileURL(path.join(toolRoot, "src", "handoff-engine.mjs")),
  );
  const { syncExistingPair } = await import(
    pathToFileURL(path.join(toolRoot, "src", "paired-handoff-engine.mjs")),
  );
  process.env.CODEX_BIN = await findCodexBinary();
  const appServerOptions = {
    cwd: testCwd,
    configOverrides: {
      model_provider: "openai",
      model: "gpt-5.6-sol",
      forced_login_method: "chatgpt",
    },
  };

  const startClient = await createAppServerClient(appServerOptions);
  let started;
  try {
    started = await startClient.request("thread/start", {
      cwd: testCwd,
      modelProvider: "openai",
      model: "gpt-5.6-sol",
      historyMode: "paginated",
    });
    await startClient.request("thread/inject_items", {
      threadId: started.thread.id,
      items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "seed" }] }],
    });
  } finally {
    await startClient.close();
  }
  const threadId = started?.thread?.id;
  const rolloutPath = started?.thread?.path;
  assert.ok(threadId, "isolated thread/start did not return a thread id");
  assert.ok(rolloutPath, "isolated thread/start did not return a rollout path");
  const baselineRollout = await readFlattenedRollout(rolloutPath);

  const client = await createAppServerClient(appServerOptions);
  let clientClosed = false;
  try {
    const loadedBefore = await client.request("thread/loaded/list", {});
    assert.equal(loadedBefore.data.includes(threadId), false);

    const read = await client.request("thread/read", { threadId, includeTurns: false });
    assert.equal(read.thread.status?.type, "notLoaded");
    const loadedAfterRead = await client.request("thread/loaded/list", {});
    assert.equal(loadedAfterRead.data.includes(threadId), false);

    await assert.rejects(
      client.request("thread/inject_items", {
        threadId,
        items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "before resume" }] }],
      }),
      /thread not found/,
    );

    await resumeAndWaitForPairTarget({
      client,
      targetThreadId: threadId,
      resumeParams: {
        threadId,
        cwd: testCwd,
        modelProvider: "openai",
        model: "gpt-5.6-sol",
        excludeTurns: false,
      },
    });

    const loadedAfterResume = await client.request("thread/loaded/list", {});
    assert.equal(loadedAfterResume.data.includes(threadId), true);
    await client.request("thread/inject_items", {
      threadId,
      items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "after resume" }] }],
    });
    await client.close();
    clientClosed = true;
    const afterClient = await createAppServerClient(appServerOptions);
    try {
      await resumeAndWaitForPairTarget({
        client: afterClient,
        targetThreadId: threadId,
        resumeParams: {
          threadId,
          cwd: testCwd,
          modelProvider: "openai",
          model: "gpt-5.6-sol",
          excludeTurns: false,
        },
      });
    } finally {
      await afterClient.close();
    }
    const afterRollout = await readFlattenedRollout(rolloutPath);
    assert.ok(
      afterRollout.records.length > baselineRollout.records.length,
      "resume 后注入没有增加 rollout 历史项",
    );
  } finally {
    if (!clientClosed) await client.close();
  }

  // thread/name/set 对“已存储但未加载”的任务是否可用，决定标记流程要不要先 resume。
  const taggedName = taggedThreadName("openai", "集成测试标记任务");
  let nameSetWithoutResume = null;
  const namingClient = await createAppServerClient(appServerOptions);
  try {
    try {
      await namingClient.request("thread/name/set", { threadId, name: taggedName });
      nameSetWithoutResume = true;
    } catch (error) {
      nameSetWithoutResume = false;
      process.stderr.write(`未加载状态直接改名被拒：${error.message}\n`);
    }
  } finally {
    await namingClient.close();
  }
  const tagged = await setThreadName({
    threadId,
    provider: "openai",
    model: "gpt-5.6-sol",
    cwd: testCwd,
    name: taggedName,
  });
  assert.equal(tagged.applied, true, "带 resume 兜底的改名必须成功并回读校验");
  assert.equal(tagged.verified, true);
  assert.equal(stripProviderTag(taggedName), "集成测试标记任务");
  process.stdout.write(`nameSetWithoutResume=${nameSetWithoutResume} resumed=${tagged.resumed}\n`);

  // 配对标记：第二个端点 + 幂等复跑，验证 [GPT]/[DeepSeek] 前缀不会叠加。
  const secondClient = await createAppServerClient(appServerOptions);
  let secondThreadId;
  try {
    const secondStart = await secondClient.request("thread/start", {
      cwd: testCwd,
      modelProvider: "openai",
      model: "gpt-5.6-sol",
      historyMode: "paginated",
    });
    secondThreadId = secondStart.thread.id;
    // 空线程没有 rollout，官方不保证其可持久化；先写入种子历史再作为配对端点。
    await secondClient.request("thread/inject_items", {
      threadId: secondThreadId,
      items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pair seed" }] }],
    });
  } finally {
    await secondClient.close();
  }
  const firstTagging = await ensurePairTags({
    openaiThreadId: threadId,
    deepseekThreadId: secondThreadId,
    fallbackName: "兜底任务名",
    cwd: testCwd,
  });
  assert.equal(firstTagging.applied, true, `配对标记应当成功：${JSON.stringify(firstTagging)}`);
  assert.equal(firstTagging.baseName, "集成测试标记任务", "基础名应取端点当前名去掉前缀后的结果");
  assert.equal(stateRow(threadId).name, "[GPT] 集成测试标记任务");
  assert.equal(stateRow(secondThreadId).name, "[DeepSeek] 集成测试标记任务");

  const secondTagging = await ensurePairTags({
    openaiThreadId: threadId,
    deepseekThreadId: secondThreadId,
    fallbackName: "兜底任务名",
    cwd: testCwd,
  });
  assert.equal(secondTagging.applied, true, "重复标记应当幂等通过");
  assert.equal(secondTagging.tags.openai.changed, false, "重复标记不应再次写入");
  assert.equal(secondTagging.tags.deepseek.changed, false, "重复标记不应再次写入");
  assert.equal(stateRow(threadId).name, "[GPT] 集成测试标记任务");
  process.stdout.write(`pairTaggingBaseName=${firstTagging.baseName}\n`);

  // 源端在游标之后只多出一条 task_complete（没有正文项）时，交接必须记为 noop 并推进游标，
  // 而不是把整个任务判为失败。
  const sourceRolloutPath = stateRow(threadId).rollout_path;
  const targetRolloutPath = stateRow(secondThreadId).rollout_path;
  const sourceRecordsBefore = (await readFlattenedRollout(sourceRolloutPath)).records.length;
  const targetRecordsBefore = (await readFlattenedRollout(targetRolloutPath)).records.length;
  await appendProjectionEvents(sourceRolloutPath, [{
    value: {
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "01a0a858-0000-0000-0000-000000000000",
        last_agent_message: null,
        error: { message: "unexpected status 401 Unauthorized", codex_error_info: "other" },
        started_at: 1789530798,
        completed_at: 1789530828,
        duration_ms: 30157,
      },
    },
  }]);
  const projectionOnlySync = await syncExistingPair({
    task: {
      stableTaskId: "isolated-projection-only",
      displayName: "隔离任务",
      explicitName: "隔离任务",
      providerThreads: { openai: threadId, deepseek: secondThreadId },
      pairSync: {
        openai: { threadId, recordCount: sourceRecordsBefore },
        deepseek: { threadId: secondThreadId, recordCount: targetRecordsBefore },
      },
    },
    sourceThreadId: threadId,
    sourceProvider: "openai",
    targetProvider: "deepseek",
    targetThreadId: secondThreadId,
    targetModel: "deepseek-v4-pro",
    targetReasoningEffort: null,
  });
  assert.equal(projectionOnlySync.type, "paired-noop", "只有投影事件的增量应记为 noop");
  assert.equal(projectionOnlySync.reason, "paired-delta-without-response-items");
  assert.equal(projectionOnlySync.skippedRecordCount, 1);
  assert.equal(projectionOnlySync.sourceRecordCount, sourceRecordsBefore + 1, "源游标必须推进到增量末尾");
  assert.equal(projectionOnlySync.targetRecordCount, targetRecordsBefore, "目标不应被写入");
  process.stdout.write(`projectionOnlySync=${projectionOnlySync.reason} skipped=${projectionOnlySync.skippedRecordCount}\n`);

  // 事件里嵌着消息内容时不能跳过：必须镜像进目标并推进双方游标。
  await appendProjectionEvents(sourceRolloutPath, [{
    value: {
      type: "event_msg",
      payload: {
        type: "item_completed",
        thread_id: threadId,
        turn_id: "01a0a900-0000-0000-0000-000000000000",
        item: { type: "agentMessage", id: "msg-isolated-projection", text: "镜像内容" },
        started_at_ms: 1,
        completed_at_ms: 2,
      },
    },
  }]);
  const contentProjectionSync = await syncExistingPair({
    task: {
      stableTaskId: "isolated-projection-only",
      displayName: "隔离任务",
      explicitName: "隔离任务",
      providerThreads: { openai: threadId, deepseek: secondThreadId },
      pairSync: {
        openai: { threadId, recordCount: projectionOnlySync.sourceRecordCount },
        deepseek: { threadId: secondThreadId, recordCount: projectionOnlySync.targetRecordCount },
      },
    },
    sourceThreadId: threadId,
    sourceProvider: "openai",
    targetProvider: "deepseek",
    targetThreadId: secondThreadId,
    targetModel: "deepseek-v4-pro",
    targetReasoningEffort: null,
  });
  assert.equal(contentProjectionSync.type, "paired-synced", "嵌内容的投影事件应镜像进目标");
  assert.equal(contentProjectionSync.projectionOnly, true);
  const targetRecordsAfterProjection = (await readFlattenedRollout(targetRolloutPath)).records.length;
  assert.equal(
    targetRecordsAfterProjection,
    projectionOnlySync.targetRecordCount + 1,
    "嵌内容的投影事件必须写入目标 rollout",
  );
  process.stdout.write(`contentProjectionSync=${contentProjectionSync.reason} targetRecords=${targetRecordsAfterProjection}\n`);
} finally {
  try {
    await fs.rm(tempHome, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    cleanupPending = true;
    process.stderr.write(`集成测试临时目录未能立即清理：${tempHome}\n${error.message}\n`);
  }
}

process.stdout.write(JSON.stringify({ status: "ok", cleanupPending, tempHome }, null, 2) + "\n");

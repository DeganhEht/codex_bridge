import { createAppServerClient } from "./appserver-client.mjs";
import { DEFAULT_PROVIDER, DEEPSEEK_MODEL, PROJECT_CWD } from "./constants.mjs";
import { loadAndValidateSchema } from "./schema-guard.mjs";
import { parseArgs } from "./utils.mjs";
import { verifyThread } from "./verify-mirror.mjs";
import {
  batchHandoff,
  buildHandoffCandidates,
  discoverLocalTasks,
  tagPairedEndpoints,
} from "./batch-handoff-engine.mjs";
import { pairRepair, pairRepairFinalize } from "./pair-repair-engine.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0] || "help";
  if (command === "help") {
    process.stdout.write("用法: node src/cli.mjs schema-check | batch-inventory [--target-provider P] | batch-handoff-dry-run --target-provider P [--only-task-id ID|--task-ids ID1,ID2] [--force-rebuild] | batch-handoff --execute --target-provider P [--only-task-id ID|--task-ids ID1,ID2] [--force-rebuild] | tag-pairs [--stable-task-ids ID1,ID2] | pair-repair-dry-run --target-provider P --stable-task-ids ID1,ID2 | pair-repair --execute --strategy clean-rebuild --target-provider P --stable-task-ids ID1,ID2 | pair-repair-finalize --target-provider P --stable-task-ids ID1,ID2 | verify ...\n");
    return;
  }
  if (command === "schema-check") {
    print(await loadAndValidateSchema());
    return;
  }
  if (command === "batch-inventory") {
    print({
      type: "batch-inventory",
      tasks: options["target-provider"]
        ? await buildHandoffCandidates({ targetProvider: options["target-provider"] })
        : await discoverLocalTasks(),
    });
    return;
  }
  if (command === "tag-pairs") {
    print(await tagPairedEndpoints({
      stableTaskIds: options["stable-task-ids"] || options["task-ids"] || null,
    }));
    return;
  }
  if (command === "batch-handoff-dry-run" || command === "batch-handoff") {
    if (command === "batch-handoff" && options.execute !== true && options.execute !== "true") {
      throw new Error("batch-handoff 必须显式带 --execute");
    }
    const targetProvider = options["target-provider"] || DEFAULT_PROVIDER;
    print(await batchHandoff({
      execute: command === "batch-handoff",
      targetProvider,
      onlyTaskId: options["only-task-id"] || null,
      taskIds: options["task-ids"] || null,
      forceRebuild: options["force-rebuild"] === true || options["force-rebuild"] === "true",
    }));
    return;
  }
  if (command === "pair-repair-dry-run" || command === "pair-repair" || command === "pair-repair-finalize") {
    if (command === "pair-repair-finalize") {
      print(await pairRepairFinalize({
        targetProvider: options["target-provider"] || "deepseek",
        stableTaskIds: options["stable-task-ids"] || options["task-ids"] || null,
      }));
      return;
    }
    if (command === "pair-repair" && options.execute !== true && options.execute !== "true") {
      throw new Error("pair-repair 必须显式带 --execute");
    }
    print(await pairRepair({
      execute: command === "pair-repair",
      targetProvider: options["target-provider"] || "deepseek",
      stableTaskIds: options["stable-task-ids"] || options["task-ids"] || null,
      strategy: options.strategy || "clean-rebuild",
    }));
    return;
  }
  if (command === "verify") {
    const threadId = options["thread-id"] || options.threadId;
    if (!threadId) throw new Error("verify 需要 --thread-id");
    const provider = options.provider || DEFAULT_PROVIDER;
    const client = await createAppServerClient({
      cwd: PROJECT_CWD,
      configOverrides: provider === "deepseek" ? {
        model_provider: "deepseek",
        model: options.model || DEEPSEEK_MODEL,
        ...(options["reasoning-effort"]
          ? { model_reasoning_effort: options["reasoning-effort"] }
          : {}),
        forced_login_method: "api",
      } : {},
    });
    try {
      print(await verifyThread(client, threadId));
    } finally {
      await client.close();
    }
    return;
  }
  throw new Error(`未知命令: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

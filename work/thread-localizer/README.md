# Codex-DeepSeek-Handoff: thread-localizer

This tool keeps local Codex desktop tasks usable while switching between the
ChatGPT/OpenAI provider and the official DeepSeek Responses API provider. It
uses the installed Codex `app-server` protocol and does not send model turns.

This directory is the runtime CLI used by the public repository root. The
desktop installation files live beside it under `launcher/`; use the root
README for the end-user install flow.

## Current design

Each logical task has a stable id in `data/batch-handoff-manifest.json`. The
manifest points to exactly one current baton (`currentThreadId`, provider, and
model). A provider switch processes every managed task independently:

1. discover all non-archived interactive tasks with `thread/list` and
   `modelProviders: []`;
2. auto-enroll new OpenAI and DeepSeek tasks;
3. generate a dry-run report before task-state writes;
4. fork each completed source task to the target provider/model;
5. preserve its name, project `cwd`, pin state, and remembered OpenAI model;
6. verify provider, model, thread source, project path, turn count, item count,
   and visible message count;
7. normalize DeepSeek reasoning records before an OpenAI task is opened;
8. atomically point the manifest at the verified replacement;
9. permanently delete the previous baton through `thread/delete`.

A failure or active turn blocks only that task. Other tasks continue through
the pipeline. The desktop launcher treats any blocked or failed task as a
closed gate: it shows the result report path and does not open Codex.

Before the first app-server request, the tool validates the installed Codex
protocol schema. By default, the schema is generated from the same Codex
executable that the launcher selected and cached under
`%USERPROFILE%\.codex\model-switcher\app-server-schema\<codex-version>`. An
explicit `CODEX_SCHEMA_ROOT` remains available for diagnostics. The cache is
versioned and records the Codex binary signature and `ClientRequest.json`
SHA-256; a missing or stale cache is regenerated, while an incompatible
schema still stops the handoff. The tool no longer depends on `C:\tmp`.

The launcher also holds a per-user handoff lock. If the DeepSeek launcher is
still handing tasks back to OpenAI after the app closes, the GPT handoff
shortcut waits for that work to finish instead of starting a second handoff or
opening an empty Codex window.

Each provider entry also holds its own non-queuing request lock. The first
click immediately shows a short handoff notice and owns that provider request
until it finishes. Additional clicks on the same shortcut exit silently, so
they cannot queue another fork, create duplicate conversations, or show a
second Codex window later.

The legacy single-task manifest remains as migration history. The active
single-task baton is imported once into the multi-task manifest and is not
forked merely because of the import.

## Project placement

Codex project grouping follows the task `cwd`. The pipeline preserves it. Add
an entry to `projectMappings` in `data/handoff-settings.json` only when an old
task needs to be moved to a canonical project directory.

## Provider and model configuration

`data/handoff-settings.json` is the single source of truth for active models.

- OpenAI uses `preserve-existing`, so a task that used Luna returns to Luna and
  a task that used Sol returns to Sol. A DeepSeek-originated task with no prior
  OpenAI model uses the configured OpenAI default.
- DeepSeek uses `preserve-existing`. Codex's native in-thread picker can switch
  a DeepSeek task between V4 Pro/V4 Flash and Low/High/Max. Discovery records
  both sticky values, and the next DeepSeek handoff restores that task's last
  combination. A task with no DeepSeek history uses the configured defaults.

Some Codex Desktop releases hide third-party model slugs behind a remote
allowlist. During DeepSeek mode, the launcher therefore builds a local picker
catalog with two allowlisted compatibility slugs and starts a loopback-only
model-name adapter. The adapter changes only the outgoing `model` value back
to the official DeepSeek slug and streams every other request and response
field untouched. OpenAI traffic never uses this adapter.

The default is `deepseek-v4-pro + max`. First confirm both exact API slugs and
their supported reasoning levels in
`%USERPROFILE%\.codex\model-switcher\models-deepseek.json`. The launcher
refuses to start if the default slug is missing. Switching model or effort in
the open Codex task changes subsequent turns in place; no handoff copy is
created merely for an in-thread DeepSeek setting change.

## Managed scope

The default managed providers are `openai` and `deepseek`. Tasks belonging to
older `custom` providers are listed in reports as `unmanaged-provider` and are
not changed. Archived, excluded, subagent, and test-mirror tasks are not
auto-enrolled.

## Commands

Run from `work/thread-localizer`:

```powershell
node src/cli.mjs schema-check
node src/cli.mjs batch-inventory
node src/cli.mjs batch-handoff-dry-run --target-provider deepseek
node src/cli.mjs batch-handoff-dry-run --target-provider openai
node src/cli.mjs batch-handoff --execute --target-provider deepseek
node src/cli.mjs batch-handoff --execute --target-provider openai
```

Use `--only-task-id <stable-or-current-id>` for a one-task acceptance test.
Dry-run and execution reports are written under `reports/`.

`node src/cli.mjs schema-check` may create or refresh the versioned schema
cache. It never starts a model turn or changes task history.

For a one-task acceptance run, add `--only-task-id <stable-or-current-id>` to
both the dry run and execute command. Keep the generated report private; it
can contain task names and message metadata.

## Desktop entries

- Use the DeepSeek shortcut when switching from GPT to DeepSeek.
- Use the desktop `交接给GPT` shortcut when switching from DeepSeek to GPT.
- The standard taskbar Codex icon remains a direct GPT entry. Use it only when
  the previous session was already GPT and no provider handoff is pending.

## Safety rules

- `capabilities.experimentalApi = true` is always declared at initialization.
- A task with an active turn or JSONL parse error is never forked.
- Handoffs do not create cumulative task, rollout, or SQLite backups.
- The tool never edits `state_5.sqlite` or `session_index.jsonl` directly.
- Source rollouts are never modified.
- DeepSeek reasoning normalization modifies only the newly created OpenAI
  target rollout while the untouched source still exists.
- A failed target is deleted; a verified replacement is committed before its
  predecessor is permanently deleted through the official app-server.
- No command in this pipeline starts a model response.
- The launcher controls desktop startup, but the migration CLI does not start
  or control the Codex UI.

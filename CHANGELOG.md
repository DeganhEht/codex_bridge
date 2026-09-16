# Changelog

All notable changes to this project are recorded here.

## 1.2.4 - 2026-09-16

- Added a login guard for the last remaining "no adapter" case: launching Codex from its
  own icon instead of a shortcut. The installer registers a scheduled task
  (`CodexDeepSeekAdapterGuard`, at logon and then once a minute) which runs
  `ensure-deepseek-adapter.ps1`. The guard starts the adapter only when the managed mode
  is `deepseek`, a `ChatGPT.exe` process is running and nothing is listening on the
  configured port; otherwise it exits (or reuses the healthy adapter).
- The guard is deliberately non-invasive so it cannot fight the shortcuts or the
  launcher: it never edits `config.toml`, never creates or removes shortcuts, never
  terminates a process, gives up when the port belongs to another program, and takes the
  same `Local\CodexDeepSeekAdapterGuard` mutex so two runs cannot overlap. Uninstalling
  removes the task again.
- The adapter's lifetime watchdog now also runs without `--parent-pid` (the guard starts
  it that way): supervised adapters stay alive while the launcher waits, unsupervised
  ones keep serving while Codex runs and clean themselves up afterwards. The health
  response gained a `supervised` field.
- Added `scripts/test-adapter-guard.ps1` (5 decision cases: non-DeepSeek mode, Codex not
  running, would start, reuse a healthy adapter, yield to a foreign port) and extended the
  install-layout test to cover the new file and task removal.

## 1.2.3 - 2026-09-16

- Fixed the "DeepSeek mode shows a network interruption" class of failures. DeepSeek-mode
  Codex sends every request to the local adapter, so an adapter that is not running looks
  exactly like a broken network.
- The adapter no longer exits when the launcher window disappears. Its lifetime is now
  tied to Codex: it keeps serving while any Codex process is running, and closes itself
  `codexGraceMs` (default 30 s) after the last Codex process is gone. Before the first
  Codex start it waits `initialGraceMs` (default 3 min) instead of leaving an orphan.
  The health response exposes a `lifetime` block (`parentPid`, `parentAlive`,
  `codexRunning`, `everSawCodex`) so the state is diagnosable.
- A failed handoff that rolls back to DeepSeek now restores the runtime as well as
  `config.toml`: the launcher restarts the adapter before exiting, so "handoff to GPT
  failed, go back to DeepSeek" no longer leaves Codex pointed at a dead port.
- README (zh/en/ja) and `docs/troubleshooting.md` explain how to tell the two causes
  apart (nothing listening vs. blocked outbound traffic) and document the health fields.

## 1.2.2 - 2026-09-16

- Fixed the paired-sync verification so it compares what is actually injected. The
  target rollout envelope (`timestamp`, `ordinal`, `metadata`, ...) is written by the
  Codex app-server and never carried over from the source, so the previous
  whole-record fingerprint could not match for any delta containing such records
  (for example `send_message_to_thread` tool results). The task was then reported as
  `partial-sync` even though every record had been written. Comparison now runs on
  `type` + `payload` only, treats `null` as "missing", and adds a field-level diff
  summary to the error when a block really differs.
- Recovery: a `partial-sync` task with a matching `pendingSync` is no longer blocked
  outright. The engine reconciles the block that is already present (without
  re-injecting anything) and commits the cursor; it still refuses to inject when the
  written block cannot be identified, and the `pendingSync` fingerprint check now
  tolerates fingerprint-algorithm changes as long as the recorded boundaries and the
  block itself match.
- DeepSeek compatibility: content parts of type `encrypted_content` (produced by
  multi-agent message tools) are stripped for DeepSeek targets - when injecting new
  history and in the local model-name adapter for history that is already stored -
  because DeepSeek rejects them (`input: unknown variant 'encrypted_content'`) and
  fails the whole turn. Stripped arrays keep their other parts, or fall back to a
  placeholder text part instead of an empty array. Both the adapter health response
  and the compatibility log report the counters.

## 1.2.1 - 2026-09-16

- Documentation: the three READMEs were restructured into quick starts and retitled
  `Codex Bridge` to match the repository name. The beginner walkthrough moved to
  `docs/install.md`, the FAQ kept only the most common entries, and a new
  "install it with Codex" section adds copy-paste prompts for installing, updating and
  troubleshooting through a Codex session.
- Documentation: the credits now state explicitly that the project builds on the Codex
  desktop app and the official DeepSeek API, and that there is no affiliation with or
  endorsement by OpenAI or DeepSeek.
- No functional changes: the code is identical to 1.2.0, this release only republishes the
  project with the new documentation.

## 1.2.0 - 2026-09-16

Derivative release based on
[kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
(MIT, Copyright (c) 2026 kaidongli30-cpu). The upstream MIT license and copyright
notice are kept unchanged in `LICENSE`.

- Replaced one-shot copies with persistent paired endpoints: one GPT endpoint and
  one DeepSeek endpoint per logical task, synchronized by delta with cursors,
  fingerprints, duplicate-block detection and partial-write guards.
- Desktop launcher: multi-task selection with sortable columns, an
  "only open Codex" entry, reopening every selected target after a handoff,
  `last-handoff.json` / `last-opened.json` records, and a shared result contract.
- Endpoint tagging through the official `thread/name/set`: `[GPT]` / `[DeepSeek]`
  prefixes, applied once, preserving manual renames, plus a `tag-pairs` command.
- DeepSeek compatibility: the local model-name adapter now honors
  `HTTPS_PROXY` / `HTTP_PROXY` (with proxy auth and `NO_PROXY`), drops orphan
  tool-result items that DeepSeek rejects (`missing field call_id`), logs each
  drop, and exposes `proxyConfigured` / `proxyRequests` in its health response.
- Sidebar visibility: copies the desktop client's per-thread registration
  (workspace-root hint, projectless list, writable roots) and backfills
  `preview` / `first_user_message` / `title` for tool-created endpoints, because
  the sidebar's fast list skips threads without a preview. The preview backfill
  writes only empty columns, backs up `state_5.sqlite` first, verifies by
  reading back, and restores the backup on mismatch.
- Shutdown safety: closing DeepSeek-mode Codex no longer rewrites the config or
  runs an automatic return handoff; the launcher stops the adapter and exits.
- Recovery: `pair-repair` clean rebuild, projection-only delta handling, tolerant
  handling of deltas that contain no injectable Responses items, and explicit
  failure reasons in reports.
- Testing: 53 Node tests plus PowerShell suites for the picker, sidebar
  registration, result contract and install layout; CI workflow kept from
  upstream.
- Removed the upstream single-endpoint leftovers that the paired workflow never
  uses: the `cleanup-generated-history` tool, the rolling-handoff CLI path, the
  legacy single-task manifest recording (and its test manifest), and five dead
  helpers, plus handoff options that no longer had any reader
  (`emitDryRun`, `recordManifest`). Net effect is roughly 400 fewer lines to
  maintain.
- Renamed the desktop entries to `交接给deepseek.lnk` and `交接给GPT.lnk`
  (the previous `DeepSeek交接.lnk` / `任务交接GPT.lnk` are now cleaned up as
  legacy names), and updated all docs to match.

## Unreleased

- Prepared the project for a public, local-first release.
- Made the desktop launcher discover its handoff tool and model catalog from
  its installed location or explicit environment variables.
- Kept DeepSeek's default reasoning effort at `max` and web search at `live`.
- Added installer/uninstaller scripts, contributor and security guidance, and
  CI checks for Node tests and PowerShell syntax.
- Added idempotent first-run config bootstrap and both GPT/DeepSeek handoff
  desktop entries.
- Stopped redistributing the official DeepSeek model catalog and unverified
  branded icon; installation now reuses the official local setup.
- Added isolated install/uninstall CI coverage that preserves task manifests,
  reports, official provider files, and encrypted credentials.

## 0.1.0

- Added multi-task handoff through the Codex app-server protocol.
- Added dry-run reports, per-task manifests, backups, and provider-aware
  verification.
- Added DeepSeek-to-OpenAI normalization for reasoning `content: null` and
  linked web-search record identifiers.

# Changelog

All notable changes to this project are recorded here.

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

# Codex Bridge

<p align="center"><a href="README.md">简体中文</a> | <b>English</b> | <a href="README.ja.md">日本語</a></p>

Keep working on the same task in the Codex desktop app with GPT and DeepSeek: each task
keeps one `[GPT]` endpoint and one `[DeepSeek]` endpoint, and only new content is synced
between them, so no duplicate tasks pile up.

> Windows 10/11 only. This page is the quick start. The step-by-step walkthrough
> (Chinese) is in [docs/install.md](docs/install.md); the sections below are enough for
> most users.

## Credits and upstream

This project is a heavily modified derivative of
[kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
(MIT License, Copyright (c) 2026 kaidongli30-cpu). Upstream provides the original
GPT-to-DeepSeek handoff base and installer; this repository turns the handoff into
**persistent paired endpoints with delta synchronization** and adds the desktop
usability and troubleshooting work listed in [CHANGELOG.md](CHANGELOG.md). The upstream
MIT copyright notice is kept in [LICENSE](LICENSE).

Third-party assets: DeepSeek's official model catalog and the official Codex setup
script stay on your machine. This repository does not redistribute them, nor DeepSeek's
branded icons; the installer only reuses the official setup you already completed.

Codex Bridge builds on two official components: the **Codex desktop app** (through its own
`app-server`) and the **official DeepSeek API**. This is a third-party tool with no
affiliation with, or endorsement from, OpenAI or DeepSeek; those names belong to their
respective owners.

Maintainer: the rewrite and maintenance of this repository are by `DeganhEht`.

## What problem does this project solve?

DeepSeek's official integration already connects Codex to DeepSeek, but after switching
configurations you often run into this:

- tasks that were visible in GPT mode do not appear in DeepSeek mode;
- new DeepSeek replies cannot be continued after switching back to GPT;
- DeepSeek reasoning or web-search records make GPT report format errors.

Codex Bridge adds a local "task handoff" layer: the moment you click a desktop shortcut
and tick tasks, it syncs the new content to the other side and reopens Codex in the
target mode.

```text
Work in GPT → close Codex completely → double-click "交接给deepseek" → tick tasks → continue in DeepSeek
Work in DeepSeek → close Codex completely → double-click "交接给GPT" → tick tasks → continue in GPT
```

## Three things to know before you start

1. **This is not Codex and it does not provide a DeepSeek API key.** Install Codex first
   and use your own official DeepSeek API key.
2. **Always close Codex completely before switching.** Never run GPT mode and DeepSeek
   mode at the same time.
3. **Click the shortcut only once per handoff.** Large histories take a while; Codex
   opens after the tool has finished.

## Install it with Codex (recommended)

You do not have to type commands yourself. Paste the whole block below into Codex (or any
Codex session that can act on your machine); it reads the repository, installs everything
in order, and stops whenever it needs you to do something.

````text
Please install Codex Bridge on this machine: https://github.com/DeganhEht/codex_bridge

Requirements:
1. Read README.md and docs/install.md in the repository first; do not guess the steps
   from memory.
2. Execute the steps in order and say in one sentence what you are about to do before
   each step.
3. Whenever a step needs me (installing PowerShell 7 / Node.js, running DeepSeek's
   official setup script and entering my API key, closing Codex completely), stop and
   wait for my confirmation.
4. Always preview the installer with -WhatIf first and only run it for real when the
   preview is clean. Do not skip the preview.
5. When done, confirm the desktop shortcuts "交接给deepseek" and "交接给GPT" exist, then
   verify with a throwaway task: say something in GPT → hand off → confirm DeepSeek sees
   it and can reply → hand back to GPT.
6. If any step fails, paste the full error text back to me. Do not skip it or silently
   switch to a different approach.

Tell me your plan first and wait for me to answer "go".
````

To update later (this never touches your `config.toml`):

````text
Please update https://github.com/DeganhEht/codex_bridge to the latest version: run git pull
in the project folder, then run work/thread-localizer/launcher/install.ps1 -SourceRoot <project folder>
-SkipConfiguration -SkipShortcuts. Do not modify config.toml and do not recreate the
desktop shortcuts.
````

When a handoff fails, let Codex read the logs:

````text
My Codex Bridge handoff just failed. Please read the newest logs and reports under
%USERPROFILE%\.codex\model-switcher\handoff-logs\ and
%USERPROFILE%\.codex\model-switcher\thread-localizer\reports\, then tell me the cause and
the smallest fix. Do not modify any file yet.
````

Everyday handoffs need no prompt at all — just use the two shortcuts.

## Manual install (quick version)

Requirements: Windows 10/11, [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows),
[Node.js 22.13+](https://nodejs.org/en/download), a Codex desktop install you can sign in
to, and your own official DeepSeek API key.

1. Complete **DeepSeek's official setup** first (this repository does not redistribute
   the official files):

   ```powershell
   $officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
   Invoke-WebRequest -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' -OutFile $officialSetup
   notepad $officialSetup
   pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
   ```

   Confirm DeepSeek can answer a test message, then close Codex completely.

2. Get this project and open PowerShell 7 in its root folder:

   ```powershell
   git clone https://github.com/DeganhEht/codex_bridge.git
   cd codex_bridge
   pwsh
   ```

   You can also use `Code` → `Download ZIP` on the repository page and type `pwsh` in the
   address bar of the extracted folder.

3. Preview, then install:

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD" -WhatIf
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD"
   ```

4. Once the desktop shortcuts `交接给deepseek` and `交接给GPT` appear, you are done. For a
   first run, use a throwaway task and complete one full round trip.

## Everyday usage

Both shortcuts mean "target mode" and both support opening Codex **without** handing
anything over:

| Current mode | Click | What happens |
| --- | --- | --- |
| GPT | `交接给deepseek` | Lists GPT-side tasks; tick the ones to hand over, then Codex opens in DeepSeek mode |
| DeepSeek | `交接给deepseek` | Choose "just open Codex" to start the adapter and reopen your last task |
| DeepSeek | `交接给GPT` | Lists every DeepSeek-side task (including conversations started in DeepSeek mode) and syncs them back to GPT |
| GPT | `交接给GPT` | Same, for bringing leftover DeepSeek conversations back; can also just open Codex |

- Ticking several tasks opens each of them once so they all show up in the sidebar; the
  task that was actually handed over ends up in the foreground. Two or more tasks also
  produce a summary dialog (with `codex://threads/...` links) and a record in
  `%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json`.
- **Do not** launch Codex from the taskbar icon right after using DeepSeek: that bypasses
  the handoff and the newest DeepSeek content may not be in the GPT task yet.
- **Shutting down is always safe:** closing DeepSeek-mode Codex changes no config, runs
  no automatic return handoff and opens no window — it only stops the local adapter. To
  resume, click the shortcut and choose "just open Codex"; to switch modes, tick the
  tasks and the deltas get filled in.

### Task name tags and sort order

After a handoff, the two sides are renamed to `[GPT] <name>` and `[DeepSeek] <name>`:

- the prefix is added once and never stacks; names you edited yourself are kept;
- a failed tag never aborts the handoff, it is recorded and retried next time;
- the picker sorts by "recently updated" by default, clicking the
  Time / Provider·Model / Task / Working directory headers toggles ascending and
  descending, and search, multi-select and select-all keep working.

## FAQ

### 1. The installer says `models-deepseek.json` is missing

DeepSeek's official setup is not finished or the catalog is not where it is expected. Run
the official script again, confirm DeepSeek can open Codex and reply on its own, close
Codex completely, then run this installer. Never create an empty `models-deepseek.json`.

### 2. No window appears for a long time after clicking a shortcut

Do not click repeatedly; wait for the handoff to finish. If an error dialog appears, note
its full text, the report path it mentions, and which direction you were switching. See
[docs/troubleshooting.md](docs/troubleshooting.md) for deeper checks.

### 3. A handed-over task is missing from the sidebar

The desktop sidebar skips tasks whose `preview` is empty, and freshly created endpoints
have never run a turn. This version backfills the first user message from the source task
and backs up `state_5.sqlite` before writing (restoring it if verification fails). If a
task is still missing, click the matching shortcut again and tick that task.

### 4. DeepSeek replies with `input: missing field call_id`

Older versions injected a tool-result item without `call_id`, which DeepSeek rejects for
the whole request. This version no longer writes such items and additionally filters them
out of DeepSeek requests in the local adapter (your local history is untouched). The log
is written to `%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<timestamp>.txt`.

### 5. DeepSeek mode keeps reporting a network interruption

The adapter honors `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`: when direct 443 is blocked
but a local proxy works (for example `http://127.0.0.1:7892`), requests go through the
proxy; without one they stay direct. The adapter health check exposes `proxyConfigured`
and `proxyRequests`, and proxy errors land in the same `adapter-compat-<timestamp>.txt`.

More topics (format errors, web-search record conflicts, image support, duplicate old
tasks, protocol cache) are covered in [docs/troubleshooting.md](docs/troubleshooting.md).

## How to uninstall

Close Codex completely, then preview and run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" -WhatIf
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

The default uninstall removes only the managed config, the two shortcuts and the program
files. DeepSeek's official model catalog, the encrypted API key, the handoff manifest and
the reports are kept.

## Defaults

- DeepSeek reasoning effort `max`, web search `live`;
- OpenAI/GPT keeps the model the task already used whenever possible;
- the handoff remembers the last DeepSeek model and effort per task and restores them
  when you switch back; only tasks that never used DeepSeek take the defaults;
- normal users never need to edit `config.toml` by hand.

## Privacy and safety

Everything runs locally through Codex's own `app-server`: no relay server, no upload of
chat history, no API key in the repository, no direct edits to `state_5.sqlite` or source
rollouts. Dry-run reports are written before changes, and an incompatible Codex protocol
stops the tool instead of guessing fields. See [docs/safety.md](docs/safety.md).

## For developers

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
pwsh -NoProfile -File ".\scripts\test-picker-sorting.ps1"
pwsh -NoProfile -File ".\scripts\test-sidebar-sync.ps1"
pwsh -NoProfile -File ".\scripts\test-handoff-result-contract.ps1"

npm run schema-check          # inspect/cache the app-server protocol only, no model turn
npm run dry-run:deepseek      # report only
npm run dry-run:openai
```

Default model settings live in
[work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json).
A DeepSeek model slug must exist in your local official `models-deepseek.json`. Because
some desktop builds filter third-party model names, the launcher starts a loopback-only
model-name adapter in DeepSeek mode (it maps compatible names back to official slugs and
drops orphan tool results without `call_id`); GPT requests never go through it.

Further reading: [docs/architecture.md](docs/architecture.md),
[docs/compatibility.md](docs/compatibility.md),
[docs/troubleshooting.md](docs/troubleshooting.md), [docs/safety.md](docs/safety.md),
[work/thread-localizer/README.md](work/thread-localizer/README.md).

## License

[MIT License](LICENSE). DeepSeek's official model catalog and branded icons are not
redistributed here. Please do not commit personal icons, API keys, Codex databases, task
reports or chat history to a public repository.

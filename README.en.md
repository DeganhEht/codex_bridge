# Codex-DeepSeek-Handoff

<p align="center"><a href="README.md">简体中文</a> | <b>English</b> | <a href="README.ja.md">日本語</a></p>

Keep working on the same task in the Codex desktop app with GPT and DeepSeek.

> This is a local task-handoff tool that currently supports Windows only. If
> this is your first time using a command line, that is fine: this guide starts
> with how to download the project and walks through every step.

## Credits and upstream

This project is a heavily modified derivative of
[kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
(MIT License, Copyright (c) 2026 kaidongli30-cpu), which provides the original
GPT-to-DeepSeek handoff base and installer. This repository turns the handoff
into **persistent paired endpoints with delta synchronization** and adds the
desktop usability and troubleshooting work listed in
[CHANGELOG.md](CHANGELOG.md). The upstream MIT license and copyright notice are
kept in [LICENSE](LICENSE).

Third-party assets: DeepSeek's official model catalog and the official Codex
setup script stay on the user's machine. This repository does not redistribute
them, nor DeepSeek's branded icons; the installer only reuses the official setup
you already completed. Those assets remain the property of DeepSeek.

Maintainer: the rewrite and maintenance of this repository are by
`DeganhEht`; the original project and design come from the
upstream repository credited above.

## What problem does this project solve?

DeepSeek's official integration already provides a way to use Codex with
DeepSeek, but after switching configurations you often run into this:

- Tasks that were visible in GPT mode do not appear in DeepSeek mode;
- New replies from DeepSeek cannot be continued after switching back to GPT;
- DeepSeek reasoning records or web-search records can make GPT report format
  errors.

This project adds a local "handoff" layer between GPT and DeepSeek. The visible
flow is:

```text
Work in GPT
    ↓
Fully close Codex
    ↓
Click "交接给deepseek" on the desktop
    ↓
The tool hands off the tasks, then opens Codex in DeepSeek mode
    ↓
Continue the original task in DeepSeek
    ↓
Fully close Codex
    ↓
Click "交接给GPT" on the desktop
    ↓
The tool cleans up and hands off the tasks, then opens Codex in GPT mode
```

Both sides see relay versions of the same workflow. DeepSeek replies can be
handed back to GPT, and new GPT replies can be handed on to DeepSeek.

## Three things to know before you start

1. **This project is not Codex and does not provide a DeepSeek API key.** You
   need Codex installed and your own official DeepSeek API key.
2. **Fully close Codex before switching.** Never run GPT mode and DeepSeek mode
   at the same time.
3. **Click a shortcut only once during a handoff.** With a lot of history this
   can take a while; Codex opens only after the handoff finishes.

## Before you install

### 1. Confirm you are on Windows

Currently supported:

- Windows 10
- Windows 11

macOS and Linux have not been verified with this project yet.

### 2. Confirm Codex opens normally

Open Codex the way you normally do, sign in to ChatGPT/OpenAI, and open an
existing task. Then fully close Codex.

If Codex is not installed yet, install and sign in from the
[official OpenAI entry](https://developers.openai.com/) first, then come back.

### 3. Install PowerShell 7

PowerShell is the window used below for pasting and running the installation
commands. Windows ships with an older one called "Windows PowerShell"; this
project recommends **PowerShell 7**.

Open the Windows Start menu, search for and open `PowerShell 7`. In the window,
copy this command and press Enter:

```powershell
$PSVersionTable.PSVersion
```

If the first line shows major version `7`, this requirement is satisfied.

If you cannot find PowerShell 7, follow Microsoft's official instructions:

- [Microsoft: Install PowerShell 7 on Windows](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows)

Windows 11 users can also run this in a terminal:

```powershell
winget install --id Microsoft.PowerShell --source winget
```

After installing, close the old window and reopen `PowerShell 7`.

### 4. Install Node.js

In PowerShell 7, run:

```powershell
node --version
```

This project requires **Node.js 22.13.0 or newer**. The current Node.js 24 LTS
release is recommended. Versions such as `v22.13.0`, a newer `v22...`, or
`v24...` are supported; `v20...` and older versions are not.

If the installed version is too old or `node` is not recognized, download the
current **LTS (long-term support)** version from the official Node.js website:

- [Node.js download page](https://nodejs.org/en/download)

Keep the default installation options. Reopen PowerShell 7 and run
`node --version` again.

### 5. Prepare your DeepSeek API key

You need your own official DeepSeek API key. Never share it, never write it into
this project's files, and never commit it to GitHub. DeepSeek's official
documentation is here:

- [DeepSeek API official docs](https://api-docs.deepseek.com/api/deepseek-api/)

If you can already open Codex through DeepSeek's official setup, skip to the
next section.

## Download this project

### Option A: Download the ZIP (recommended for beginners)

1. Open this repository's page: <https://github.com/DeganhEht/codex_bridge>
2. Click the green `Code` button at the top.
3. Click `Download ZIP`.
4. Once downloaded, find the ZIP file in File Explorer.
5. Right-click the ZIP and choose `Extract All`.
6. Open the extracted folder.

Keep opening folders until you can see all of these at once:

```text
README.md
package.json
work folder
scripts folder
```

Seeing these files means you are in the correct "project root".

### Open PowerShell 7 in the correct folder

1. Keep the project-root window open.
2. Click the address bar at the top of File Explorer.
3. Delete the existing text.
4. Type `pwsh`.
5. Press Enter.

PowerShell 7 opens, already in the correct project folder.

Check with this command:

```powershell
Test-Path ".\work\thread-localizer\launcher\install.ps1"
```

Expected output:

```text
True
```

If it prints `False`, close PowerShell, go back into the folder that actually
contains `README.md`, `package.json`, and `work`, and type `pwsh` again.

## First installation

### Step 1: Complete DeepSeek's official setup first

This project does not redistribute DeepSeek's official model catalog, so you
must run DeepSeek's official Codex setup script first.

In the PowerShell 7 window from above, copy the whole block and press Enter:

```powershell
$officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
Invoke-WebRequest `
  -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' `
  -OutFile $officialSetup
notepad $officialSetup
```

Notepad opens the downloaded official script. Confirm the download address is
`cdn.deepseek.com`, close Notepad, then run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
```

Follow the official script's prompts to configure your DeepSeek API key.

Afterwards:

1. Fully close PowerShell and Codex.
2. Open Codex once using the entry created by DeepSeek's official script.
3. Confirm DeepSeek replies normally to a test message.
4. Fully close Codex again.

If DeepSeek itself cannot reply yet, do not install this project. The handoff
layer only works after the official base setup succeeds.

### Step 2: Preview what the installer will do

Return to the project root and open PowerShell 7 with `pwsh` as before.

Copy this whole block and press Enter:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD" `
  -WhatIf
```

`-WhatIf` means "preview only, make no real changes". You will see several
`What if:` lines and, at the end:

```text
"whatIf": true
```

This step does not migrate tasks, start Codex, or send any model request.

If a red error appears here, check the FAQ below first. Do not keep running the
real install command.

### Step 3: Install

After the preview reports no errors, run this in the same PowerShell 7 window.
It is the same command without `-WhatIf`:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD"
```

The installer will:

- back up the relevant Codex configuration;
- verify the new configuration can be read by the installed Codex;
- install the handoff tools;
- create two shortcuts on the desktop.

It does not directly modify Codex's task database, delete original tasks, or
send messages automatically.

### Step 4: Confirm the desktop shortcuts

After a successful install, the desktop should show:

```text
交接给deepseek
交接给GPT
```

Their roles are:

| Shortcut | When to click | What it does |
| --- | --- | --- |
| `交接给deepseek` | You are using GPT and want to switch to DeepSeek | Hands GPT tasks to DeepSeek, then opens Codex |
| `交接给GPT` | You are using DeepSeek and want to return to GPT | Cleans up and hands DeepSeek tasks back to GPT, then opens Codex |

## Your first handoff

Use a throwaway test task for the first acceptance check.

### Switching from GPT to DeepSeek

1. Open Codex with the normal GPT sign-in.
2. Create a test task and send an easy-to-recognize message, for example:

   ```text
   This is a GPT and DeepSeek handoff test.
   ```

3. Wait for GPT to finish replying.
4. Fully close Codex.
5. Wait a few seconds and confirm the Codex window is completely gone.
6. Double-click `交接给deepseek` on the desktop.
7. **Click once, then wait.**
8. When the handoff finishes, Codex opens automatically with the DeepSeek
   configuration.
9. Find the test task in "Recent" or in the matching project.
10. Confirm you can see GPT's test message and reply.
11. Ask DeepSeek to reply in the same task.

### Switching from DeepSeek back to GPT

1. Wait until DeepSeek finishes replying.
2. Fully close Codex.
3. Wait a few seconds.
4. Double-click `交接给GPT` on the desktop.
5. **Click once, then wait.**
6. The tool first handles reasoning and web-search records that are
   incompatible with GPT.
7. When it finishes, Codex returns to the GPT sign-in configuration.
8. Open the test task.
9. Confirm you can see what DeepSeek just sent.
10. Send GPT another message and confirm it replies.

If all of the above works, bidirectional handoff is working.

## Everyday usage

Both shortcuts mean "target mode", and both can also just open Codex without a
handoff:

- **`交接给deepseek`:** close Codex first, then click it. The picker lists the
  GPT-side tasks; select them to hand off, write the DeepSeek configuration,
  start the local adapter and open Codex in DeepSeek mode. You can also pick
  **"仅打开 Codex（继续当前模式）"** to only start the adapter and reopen the last
  task.
- **`交接给GPT`:** close Codex first, then click it. The picker lists every
  DeepSeek-side task (including conversations created while running in DeepSeek
  mode); select them to synchronize and open Codex in GPT mode.

When you select several tasks at once, every selected task is opened once, one
after another, so all of them show up in the Codex sidebar (identified by the
`[GPT]` / `[DeepSeek]` prefix); the foreground ends on the task that actually
changed in this run. Runs that process two or more tasks also show a summary
popup with each task name and its `codex://threads/...` link, and write the same
list to `%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json`.

Do not click the official Codex icon in the taskbar right after using DeepSeek.
That bypasses the handoff step, and the newest DeepSeek content may not appear
in the GPT task yet.

### Shutting down and reopening

- **Closing DeepSeek-mode Codex triggers nothing automatic:** the launcher only
  stops the local adapter, keeps `config.toml` as it is, and exits. No
  configuration write, no reopened window, no synchronization, so shutting the
  machine down right after closing Codex is safe.
- Synchronization only happens at the moment you click a shortcut and select
  tasks, so shutting down can never interrupt a handoff.
- To resume later, click the matching shortcut and choose **"仅打开 Codex
  （继续当前模式）"**. It reopens the last task through a deep link when a record
  exists, otherwise it starts Codex normally.
- After DeepSeek-mode Codex closes, the adapter has exited too. Starting Codex
  from the official icon at that point keeps the DeepSeek configuration but has
  no adapter, so requests fail. Always use `交接给deepseek` when you want DeepSeek.

### Task name tags and selection order

After a handoff the two endpoints of the same work are renamed to:

```text
[GPT] original task name
[DeepSeek] original task name
```

- The prefix is applied once; repeated handoffs never stack `[GPT] [GPT] ...`.
- A task you renamed yourself keeps your name and only gets the prefix back.
- Tagging failures never abort a handoff; they are recorded in the report and
  retried on the next handoff.
- The task picker sorts by "last updated" (newest first) by default. Click the
  `Time / Provider·model / Task / Working directory` headers to change the sort
  direction; search and checkboxes keep working as before.

## Why doesn't Codex appear immediately after I click a shortcut?

This is by design; it does not mean the shortcut is broken.

The tool must first:

1. find the tasks that need handoff;
2. check whether they were already handed off, to avoid duplicates;
3. back up the needed data;
4. convert incompatible records;
5. verify the handoff result;
6. only then open Codex.

The more tasks there are, the longer it may take. Clicking the shortcut again
does not make it faster and may make you think the program is stuck, so wait
for the first click to finish.

## FAQ

### 1. The installer says `models-deepseek.json` is missing

The official DeepSeek base setup has not finished successfully, or the official
model catalog is not where the installer expects it.

How to fix:

1. Rerun the official script from "Complete DeepSeek's official setup first".
2. Confirm DeepSeek opens Codex on its own and replies normally.
3. Fully close Codex.
4. Run this project's installer again.

Do not create an empty `models-deepseek.json`; an empty file cannot replace the
official model catalog.

### 2. No window appears for a long time after clicking a shortcut

Do not click repeatedly. Wait for the handoff to finish. If an error dialog
appears, record:

- the full text in the dialog;
- the report path shown in the dialog;
- whether you were switching GPT → DeepSeek or DeepSeek → GPT.

See the [troubleshooting guide](docs/troubleshooting.md) for details.

### 3. The task appears in "Recent" but is not pinned

If the task opens, the messages are complete, and you can continue replying,
the handoff worked. Pinning is a Codex UI state and does not affect task
context. Pin it manually if you want.

### 4. There are two old tasks with the same name

Newer versions prefix paired tasks with `[GPT]` / `[DeepSeek]`. Early tests or
failed handoffs can leave old tasks without those tags. Do not judge by the name
alone; open them and confirm which one is newest and can still reply. Do not
directly modify Codex databases or rollout files.

### 5. GPT reports `Invalid input[*].content ... maximum length 0`

This usually means an old DeepSeek reasoning record was not converted. The
current version cleans the incompatible `content` field on new targets during
the DeepSeek → GPT handoff. Keep the error report; do not manually modify task
databases or rollouts. See the [troubleshooting guide](docs/troubleshooting.md).

### 6. Switching back to GPT fails after DeepSeek web search

DeepSeek and GPT may use different web-search record ID formats. This project
realigns the linked IDs between search calls and results when handing the task
back to GPT; if a collision is found, it stops and reports instead of deleting
records.

### 7. DeepSeek replies but cannot understand images

The handoff tool only preserves and converts task context; it does not add
vision capabilities to a model. Whether images work depends on the DeepSeek
model and API capabilities you selected.

### 8. DeepSeek fails with `input: missing field call_id`

Older versions injected an OpenAI tool-result item that had no `call_id` into
the DeepSeek task, and DeepSeek rejected the whole request
(`input: missing field call_id`).

Current versions handle it twice: a handoff no longer writes such items into a
DeepSeek task, and DeepSeek-mode requests pass through the local adapter, which
removes those orphan tool results from outgoing DeepSeek requests only. Local
chat history is untouched. Each removal is logged to:

```text
%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<timestamp>.txt
```

If a similar error returns after a Codex update, keep that log and the report
path before troubleshooting further.

## How to uninstall

Fully close Codex first.

Open PowerShell 7 and run the preview command:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" `
  -WhatIf
```

After the preview looks correct, uninstall:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

By default, uninstall removes only the managed configuration, the two
shortcuts, and the program files installed by this project. These are kept:

- DeepSeek's official model catalog;
- the encrypted API key;
- handoff manifests;
- handoff reports and manifests.

## Defaults

- DeepSeek reasoning effort: `max`
- DeepSeek web search: `live`
- OpenAI/GPT: preserve the GPT model the task was using, when known

To switch DeepSeek models later, the new model must be declared by the official
catalog and support the Responses API that Codex needs. Normal users do not
need to edit `config.toml` manually.

## Privacy and safety

This project calls the Codex `app-server` already installed on your machine:

- it does not run a chat relay server;
- it does not upload chat records to any server run by this project's author;
- it does not write API keys into Git;
- it does not directly modify `state_5.sqlite`, `session_index.jsonl`, or source
  rollouts;
- it generates a dry-run before writes and keeps the source until the new task
  passes verification;
- it does not accumulate task backups and permanently deletes the predecessor
  through the official protocol after a successful handoff;
- it stops when the installed Codex protocol is incompatible, instead of
  guessing fields and continuing;
- a handoff manifest prevents the same task from being copied twice;
- a per-user lock prevents repeated clicks from starting multiple handoffs.

See the [safety guide](docs/safety.md) for details.

## For developers

If you only want to install and use the tool, stop reading here. The rest is
for people who want to inspect the code, debug protocol issues, or contribute.

### Local tests

From the project root:

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
```

### Protocol check and dry-run

```powershell
npm run schema-check
npm run dry-run:deepseek
npm run dry-run:openai
```

`schema-check` only checks or caches the Codex app-server protocol and does not
start a model turn. Dry runs only generate reports; when changing migration
logic for the first time, validate one task before widening the scope.

### Changing the default model

Provider defaults live at
[work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json):

- OpenAI uses `preserve-existing`, returning to the GPT model the task used
  before.
- DeepSeek defaults to `deepseek-v4-pro + max`. While Codex is open in
  DeepSeek mode, the native model menu can switch the current task between
  V4 Pro/V4 Flash and Low/High/Max.
- Some Codex Desktop versions filter third-party model slugs. The launcher
  generates two local compatibility entries and, only in DeepSeek mode, runs
  a loopback-only adapter that changes the outgoing model name back to the
  official DeepSeek slug. GPT traffic bypasses it, and it does not rewrite
  message content, tool calls, search records, or response streams.
- The handoff remembers each task's last DeepSeek model and reasoning effort
  and restores them after a GPT round trip. Only tasks that have never used
  DeepSeek receive the defaults.
- The DeepSeek model slug must exist in the local official
  `models-deepseek.json`.

### Further reading

- [Architecture](docs/architecture.md)
- [Compatibility matrix](docs/compatibility.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Safety](docs/safety.md)
- [CLI and protocol details](work/thread-localizer/README.md)
- [Chinese README](README.md)
- [Japanese README](README.ja.md)

## License

This project is licensed under the [MIT License](LICENSE).

DeepSeek's official model catalog and brand icons are not redistributed with
this repository; the installer reuses the official configuration already
present on the user's machine. Do not commit personal icons, API keys, Codex
databases, task reports, or chat records to a public repository.

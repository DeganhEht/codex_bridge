# Troubleshooting

## The launcher opens no window

This is intentional when the handoff gate reports a failed or blocked task.
Open the JSON report path shown by the dialog and inspect the per-task result.
Fix the reported task or use `--only-task-id` for a controlled acceptance test;
do not repeatedly click the shortcut. The per-user lock makes extra clicks
no-ops while a handoff is running.

## The picker shows no candidates, or you only want to open Codex

Both shortcuts are "target mode" entries and both offer a third button,
`仅打开 Codex（继续当前模式）`. Choosing it skips every handoff step: the launcher
starts the DeepSeek adapter when the current mode is DeepSeek, reopens the last
task through `handoff-logs/last-opened.json` when that record exists, and
otherwise starts Codex normally. An empty candidate list is no longer an error;
the picker stays open so you can use that button.

## Closing DeepSeek-mode Codex does nothing automatic

The launcher keeps `config.toml` exactly as it is, stops the local DeepSeek
adapter, and exits when Codex closes. It never restores the GPT configuration,
never reopens a window, and never synchronizes in the background, so shutting
the machine down right after closing Codex is safe. Because the adapter stops
with the launcher, start Codex through `交接给deepseek` (not the official icon)
when you want to keep using DeepSeek in that mode.

## `Invalid input[*].content ... maximum length 0`

This means an OpenAI target received a DeepSeek reasoning record with an array
content field. A current handoff normalizes newly created OpenAI targets to
`content: null`. If the error refers to an older target, do not edit the source
rollout by hand. The failed replacement is deleted while the source remains;
repeat the handoff from that source after inspecting the dry-run report.

## Web-search records fail after switching back

DeepSeek web-search calls can use `call_*` identifiers while OpenAI expects
`ws_*`. The normalizer updates the linked `web_search_end.call_id` values and
stops on collisions. Keep the original report when reporting a new shape; do
not delete records to make a task appear to load.

## DeepSeek replies with `input: missing field call_id`

DeepSeek's Responses endpoint rejects the whole request when a
`function_call_output` or `custom_tool_call_output` item has no `call_id`.
Older OpenAI histories can contain such orphan results, and an injected history
carried them into the DeepSeek endpoint. Current versions drop those items in
both places that matter: the paired synchronizer skips them when injecting into
a DeepSeek target, and the local DeepSeek model adapter removes them from
outgoing requests. Each adapter drop is appended to
`handoff-logs/adapter-compat-<timestamp>.txt` and counted in the adapter health
response. Local history is not rewritten; if DeepSeek rejects a request for a
different reason, keep that log plus the handoff report before retrying.

## DeepSeek mode repeatedly shows a network interruption

DeepSeek-mode Codex sends every request to the local adapter on
`127.0.0.1:10101`; that adapter rewrites the picker model names and forwards to
`https://api.deepseek.com/`. Two different failures look identical in the UI.

**1. Nothing is listening (most common).** The adapter is not running, so the
desktop fails locally on every request. Check it with:

```powershell
(Invoke-WebRequest 'http://127.0.0.1:10101/__handoff_model_adapter_health' -UseBasicParsing).Content
```

The response contains `pid`, `stats` and a `lifetime` block:
`codexRunning` tells you whether the adapter can see a Codex process, and
`parentPid` / `parentAlive` show whether the launcher that started it is still
there. Use `交接给deepseek` → "just open Codex" to (re)start it.

The adapter lifetime is tied to Codex, not to the launcher window: if the
launcher process disappears while Codex is still running, the adapter keeps
serving; once Codex has been gone for 30 seconds (default `codexGraceMs`) it
closes itself, so no orphan process is left behind. A failed handoff that rolls
the config back to DeepSeek restarts the adapter before the launcher exits.

The installer also registers a scheduled task named `CodexDeepSeekAdapterGuard`
(at logon, then once a minute). It starts the adapter only when the config is in
DeepSeek mode, a Codex process is running and nothing is listening on the port;
it never edits the config, never creates or removes shortcuts and never kills a
process, so it cannot conflict with the two desktop entries. That is what covers
"launched Codex straight from its own icon".

**2. Outbound traffic is blocked.** The adapter honors `HTTPS_PROXY` /
`HTTP_PROXY` (including proxy credentials and `NO_PROXY`). This matters when
direct outbound TCP 443 is blocked but a local proxy such as
`http://127.0.0.1:7892` is available. Before this compatibility fix the adapter
used Node's direct `https.request`, so the desktop could show a generic network
interruption even though the proxy itself was working.

The adapter health response includes `proxyConfigured` and `proxyRequests`; an
upstream failure is also logged in `handoff-logs/adapter-compat-*.txt`. A quick
diagnostic is to compare the two paths:

```powershell
node -e "fetch('https://api.deepseek.com/models').catch(e => console.error(e.cause || e))"
```

Direct `EACCES`/connection failure with a successful adapter request (usually a
401 without a key) means the proxy path is doing its job. If the proxy itself is
down, restart the local proxy service before retrying Codex.

## A task reports `没有可注入的 Responses 历史项`

The source endpoint gained records after the last sync that contain no
injectable Responses item, for example a `task_complete` event that the desktop
app appended after the pair cursor was committed. Current versions treat that as
a completed synchronization instead of a failure: pure bookkeeping events are
skipped and the source cursor advances, while projection events that still embed
a message item are mirrored into the target as usual. Both outcomes are recorded
in the report (`paired-delta-without-response-items` or
`paired-delta-projection-only`). If a later run reports the same task as failed
again, attach the newest `batch-handoff-result-*.json` before retrying.

## The schema path is missing

The current implementation no longer depends on `C:\tmp`. Run
`npm run schema-check` with the same Codex installation that the shortcut will
open. It creates a versioned cache below `%USERPROFILE%\.codex\model-switcher`.
Use `CODEX_SCHEMA_ROOT` only when diagnosing a separately exported schema.

## The DeepSeek model is absent from the selector

Check that the slug in `data/handoff-settings.json` is present in the installed
`models-deepseek.json` and that the model advertises Responses API support.
Restarting the app alone does not repair a catalog typo.

## The installer says the official model catalog is missing

This repository does not redistribute DeepSeek's catalog or branded icon. Run
and test the official DeepSeek Codex setup first, then rerun this project's
installer. Do not create an empty `models-deepseek.json`: the launcher needs the
real catalog to validate the selected model before changing modes.

## Recovery

During the first paired handoff, the source remains untouched until the new
provider endpoint is fully verified. Later switches reuse the retained paired
endpoint and synchronize only the source delta. A failed newly-created target
is deleted; successful paired endpoints are intentionally retained. Git
rollback handles source-code changes only. See [safety.md](safety.md) for the
exact boundary.

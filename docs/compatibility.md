# Compatibility matrix

| Component | Supported baseline | Notes |
| --- | --- | --- |
| Windows | Windows 10/11 | The desktop launcher and shortcut scripts are Windows-specific. |
| Codex | Current installed desktop build with `app-server` | The schema guard is authoritative; unsupported fields stop the handoff. |
| App-server | `initialize`, thread list/read/items, start/resume/inject/delete, name set | `experimentalApi: true` is sent during initialization. |
| Node.js | 22.13.0 or newer; 24 LTS recommended | Required for the built-in `node:sqlite` API used by task discovery and cleanup. |
| PowerShell | 7 recommended | The launcher can fall back to Windows PowerShell when necessary. |
| OpenAI | ChatGPT login mode | Existing task model is preserved when known. |
| DeepSeek | Official Responses API provider | Complete and test the official Codex setup first; the selected slug must exist in its local model catalog. |
| DeepSeek models | V4 Pro and V4 Flash | Both exact slugs must exist in the official local catalog; the launcher builds a compatibility picker catalog for Desktop releases that filter third-party slugs. |
| DeepSeek reasoning | `low`, `high`, `max`; `max` default | The current task can change effort in the native picker; handoff remembers it per task. |
| DeepSeek web search | `live` default | Provider/model support is still required; this setting only enables the request. |
| Images | Not provided by the handoff layer | Vision support depends on the selected provider model and Codex input path. |

## Version drift

Codex app-server is an evolving local protocol. Do not hand-edit a request to
match a guess. Run `npm run schema-check`; if the schema guard reports a
mismatch, preserve the report and stop before changing task state.

## Model changes

The default is `deepseek-v4-pro + max`. With the current official catalog,
Codex exposes both V4 Pro/V4 Flash and their supported reasoning levels in the
native task menu. The handoff manifest records the task's last DeepSeek model
and effort so a later GPT-to-DeepSeek handoff restores them. If a future model
slug is added, validate the official catalog and app-server schema before
changing the default.

The compatibility picker uses two allowlisted runtime names only inside
DeepSeek mode. A loopback-only adapter maps those names to the official
DeepSeek slugs immediately before the request leaves the computer. It does not
proxy OpenAI traffic and does not alter request content or response streams.

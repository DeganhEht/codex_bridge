Codex-DeepSeek-Handoff desktop model switcher
============================

This folder contains the fallback credential helper only. The DeepSeek model
catalog and branded icon are intentionally not distributed by this project;
the installer reuses the official DeepSeek Codex setup already present under
the user's Codex home. A real API key is never stored in Git.

DeepSeek handoff entry:
  Use the desktop shortcut named 交接给deepseek.

DeepSeek-to-GPT handoff entry:
  Use the desktop shortcut named 交接给GPT. It waits for the whole handoff
  batch to finish and opens Codex only when no task is blocked or failed.
  The first click shows a short notice; repeated clicks while it is working are
  ignored and cannot queue another handoff.

The two handoff shortcuts open the same
installed Codex desktop application. They do not open a terminal task picker.

DeepSeek shortcut:
  - default model: deepseek-v4-pro
  - in-thread models: deepseek-v4-pro and deepseek-v4-flash (native Codex picker)
  - provider: https://api.deepseek.com/ using the Responses API
  - forced login method: API
  - default reasoning effort: max (native picker also exposes low/high/max)
  - web search request: live

After the DeepSeek Codex app fully exits, the hidden launcher automatically
restores GPT + ChatGPT login mode. Wait about 2-3 seconds, then the standard
taskbar Codex icon will open the normal GPT mode again.

Before switching, fully close the Codex desktop application. The launcher only
replaces the marked mode block in config.toml, validates the candidate config,
creates a timestamped backup, performs an atomic replacement, and opens the
same packaged Codex app.

The DeepSeek API key is encrypted for the current Windows user with DPAPI. The
provider asks get-deepseek-key.ps1 for the token when needed; the plaintext key
is not stored in config.toml or in either shortcut.

Before the first provider switch, the launcher runs the batch handoff pipeline
under work/thread-localizer and creates the other provider's paired endpoint.
Later switches reuse that endpoint and synchronize only new visible history and
tool results. Provider-native encrypted reasoning is never copied between
endpoints, so the two tasks can retain their own native continuation state.

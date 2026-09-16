# Architecture

## The paired handoff baton

The app-server exposes tasks as threads. The tool treats each logical task as
a pair of provider-native threads recorded in a local manifest. The manifest
records both provider thread IDs, the current endpoint, provider/model
preferences, and a per-endpoint rollout cursor. It is a deduplication index;
it is not a replacement for Codex's task database.

```text
thread/list
   ↓
discoverLocalTasks + settings filters
   ↓
dry-run report (no writes)
   ↓
thread/start (independent paginated target)
   ↓
thread/inject_items + target-only projection events
   ↓
thread/resume + thread/read + thread/items/list
   ↓
manifest stores both provider endpoints
   ↓
later switch: read source delta after cursor → inject into existing pair
```

The target is intentionally not created with `thread/fork`. Current paginated
Codex history keeps a fork reference to the source and refuses to delete that
source while the fork exists. The first switch starts an independent paginated
thread and copies the ordered history. Later switches reuse that same provider
endpoint and transfer only records after its cursor. Provider-native encrypted
reasoning is never copied between endpoints; visible messages, tool results,
and projection events are synchronized instead. A logical task therefore
remains exactly two threads rather than accumulating one thread per switch.

## Provider boundary

OpenAI tasks use `preserve-existing`, so a task that previously used a selected
GPT model can return to that model. DeepSeek stores per-task model and reasoning
effort preferences, so a task can return to its last DeepSeek combination after
a GPT round trip. The configured `deepseek-v4-pro + max` combination is only the
fallback for tasks without DeepSeek history. Model catalog entries are checked
before the launcher opens Codex.

The desktop launcher is a gate around the CLI. It acquires a per-user lock,
waits for Codex to exit, runs the batch handoff, and opens the same desktop app
only when no task failed or remained blocked. It never sends a user prompt.

## Compatibility normalization

DeepSeek Responses records can contain reasoning `content` arrays that the
OpenAI task schema rejects. The normalizer changes only the history injected
into the newly created
OpenAI target while the original source task still exists:

- reasoning `content` becomes `null`;
- thread-bound reasoning `encrypted_content` becomes `null` before every
  independent handoff, because it cannot be verified in a replacement thread;
- DeepSeek web-search IDs are mapped from `call_*` to `ws_*` and matching
  `web_search_end.call_id` references are updated;
- ordinary function-call IDs are not changed;
- collisions and missing IDs stop the handoff instead of guessing.

## Schema guard and transaction boundary

Initialization declares `capabilities.experimentalApi = true`. The schema guard
uses the selected Codex executable, caches a versioned schema under the Codex
home, and records the executable signature and request-schema hash. A stale or
missing cache is regenerated; an incompatible protocol stops before mutation.

The tool does not copy the task database or rollouts into cumulative backup
directories. It leaves both paired endpoints intact after provider, model,
count, path, and compatibility checks. A failed newly-created target is
deleted through `thread/delete`; retained paired endpoints are never treated
as cleanup predecessors. The tool never updates `state_5.sqlite`,
`session_index.jsonl`, or a source rollout in place.

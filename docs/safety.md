# Safety and data boundaries

## What the project changes

The CLI creates an independent provider endpoint through the app-server
protocol on the first switch, then incrementally synchronizes later deltas into
the retained paired endpoint. It writes target-only projection events plus its
own manifest/report files, and may normalize only history being injected into
the target. Both provider endpoints remain intact after verification. The
desktop launcher changes only its marked provider block in `config.toml`, with
a candidate parse and small timestamped configuration backup first.

Two compatibility steps touch request-shaped data instead of on-disk history:
the paired synchronizer drops tool-result items that have no `call_id` before
injecting them into a DeepSeek endpoint, and the local DeepSeek model adapter
removes the same orphan items from outgoing DeepSeek requests (logging each drop
to `handoff-logs/adapter-compat-*.txt`). Message text, tool arguments, search
records and streamed responses are forwarded unchanged, and the stored local
history keeps the original items.

## What it does not change directly

- `session_index.jsonl`
- the source rollout of a task
- the user's prompts or model turns
- API keys or `auth.json`

`state_5.sqlite` is normally only read. The single exception exists because the
desktop sidebar lists tasks from a read-only fast path that skips every thread
whose `preview` column is empty, and no app-server method can write that column.
For endpoints the tool created itself (injected history, never a running turn),
the handoff therefore copies `preview`, `first_user_message` and `title` from
the paired source thread, only while the column is still empty, only while Codex
is closed, and only for ids named in the handoff result. Before writing it backs
up `state_5.sqlite` (plus `-wal`/`-shm`) under
`reports/state-backups/state-backup-*/`, applies the update inside one
transaction with `PRAGMA busy_timeout`, reads the values back, and restores the
backup if the check fails. No other column, row or rollout is touched.

The app-server itself remains the owner of task indexing and thread creation.
The tool never creates a fork dependency from one paired endpoint to the other.

## Publishing checklist

Before making a repository public:

- run `git status --short` and inspect every staged path;
- run a credential scan for API-key prefixes, `auth.json`, DPAPI files, and
  private keys;
- remove personal icons or screenshots whose license is unclear;
- confirm reports, rollouts, SQLite files, and manifests are ignored;
- run `npm test` and PowerShell syntax checks;
- do not push until the repository name, license, and README are final.

## Real task data

Use the repository only for source and safe templates. Treat the Codex home,
rollouts, reports, and encrypted key directory as private runtime state. Task
history is not copied into cumulative backup directories. Paired endpoints
are retained as local chat data; only explicitly failed temporary targets are
deleted after verification fails. Git protects source code, not local chat data.

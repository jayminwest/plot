---
name: plot-coordination
description: Bind an agent run to a Plot — create the coordination object, author intent, attach the seeds issue, prime from the implementer view, and write events back without ever mutating intent. Use when coordinating multi-agent work through a Plot inside this repo.
---

# plot-coordination

Use this skill when you need to **drive a unit of work through a Plot**:
stand up the coordination object, hang the work's substance off it as
typed attachments, prime an agent from the relevant view, and stream the
agent's decisions / questions / artifacts back into the event log. It
encodes the canonical bind-a-run-to-a-Plot loop from `SPEC.md` (§9–§10)
so an agent can do it from a cold start without re-reading the full
design record.

The one rule that governs everything below: **agents may never mutate
intent.** `intent_edited`, `status_changed`, `attachment_removed`, and
`question_answered` are `user:*`-only and rejected at the library level
(`src/acl.ts`). An agent that thinks intent is wrong files a
`question_posed` event and waits for a human — it does not edit intent.

## Pre-flight

Verify the repo has a Plot data directory and that the store is healthy:

```bash
ls .plot/                          # per-Plot <id>.json + <id>.events.jsonl
bun run src/index.ts doctor        # exits 0 when files replay cleanly
```

If `.plot/` is empty, you create the first Plot in step 1. If `doctor`
reports a corrupt file or a replay failure, fix it (or escalate) before
continuing — never hand-edit `.plot/<id>.json` or the `.events.jsonl`
log to "fix" things. All mutations must go through the `plot` CLI (or
`PlotStore` in `src/store.ts`) so advisory locks (`src/lock.ts`) and
atomic writes (`src/io.ts`) are honoured.

Set your identity before any write. Humans authoring intent use a
`user:` actor; agents use an `agent:` actor:

```bash
export PLOT_ACTOR="user:jw"                    # human authoring intent
# or, on the agent side (orchestrator sets this on dispatch):
export PLOT_ACTOR="agent:claude_code:run-456"
```

## Procedure

### 1. Create the Plot (human)

```bash
bun run src/index.ts init "Add OAuth to billing portal"
# → prints the new id, e.g. plot-abc12345  (add --json for a JSON object)
```

Capture the printed id; every later command takes it as the first
positional argument (or reads `PLOT_ID` from the env).

### 2. Author intent and lock it (human only)

Intent is humans-only. Fill goal / non-goals / constraints / success
criteria, then transition the status so agents may be dispatched:

```bash
bun run src/index.ts intent plot-abc12345 \
  --goal "Replace email/password auth on /billing with GitHub OAuth." \
  --non-goal "Migrating existing accounts in v1" \
  --constraint "Must work with existing Stripe customer IDs" \
  --success-criteria "New users can sign in with GitHub on /billing"
bun run src/index.ts status plot-abc12345 ready
```

`status` enum: `drafting | ready | active | done | archived`. Agents are
only dispatched once a Plot is `ready` (or `active`).

### 3. Attach the work's substance (anyone)

A Plot references — never embeds — the systems that hold the real work.
Attach the seeds issue it tracks and any informing context:

```bash
bun run src/index.ts attach plot-abc12345 seeds_issue:sd-123 --role tracks
bun run src/index.ts attach plot-abc12345 mulch_record:mx-101 --role informs
```

Attachment is `<type>:<ref>`. V1 types: `seeds_issue`, `mulch_record`,
`agent_run`, `gh_pr`, `gh_issue`, `file`. Conventional roles: `tracks`,
`implements`, `informs`, `discussion`, `meeting`, `reference`.

### 4. Prime the agent from a view (agent)

An agent must never load a full Plot — it queries a view and gets
exactly what is relevant. V1 ships the hardcoded `implementer` view
(intent + last 20 substantive events + the relevant attachments).
`plot get` defaults to JSON for machine consumption; the target id comes
from the argument or `PLOT_ID`:

```bash
export PLOT_ID="plot-abc12345"     # orchestrator sets this on dispatch
bun run src/index.ts get --view implementer            # JSON for the runtime
bun run src/index.ts get --view implementer --pretty   # human-readable dump
```

### 5. Write events back (agent)

As the agent works it streams its reasoning and outputs back into the
log via `plot append --event <type> --data <json-object>`. Agents may
emit `decision_made`, `question_posed`, `artifact_produced`, `note`, and
`run_dispatched`:

```bash
bun run src/index.ts append --event decision_made \
  --data '{"summary":"Using @octokit/oauth-app","rationale":"battle-tested over a hand-rolled flow"}'

bun run src/index.ts append --event artifact_produced \
  --data '{"type":"gh_pr","ref":"owner/repo#789"}'
```

If intent looks wrong, **do not** try to change it — surface a question
and stop, leaving the human to answer:

```bash
bun run src/index.ts append --event question_posed \
  --data '{"text":"Hard-cut existing accounts or offer a migration prompt?","blocking":true}'
```

Attempting an ACL-protected event as an agent (e.g.
`--event intent_edited`) is rejected with a redirect pointing at
`question_posed` or the dedicated human command.

### 6. Persist the coordination state

`.plot/<id>.json` and `.plot/<id>.events.jsonl` are git-tracked source
of truth; the SQLite index (`.plot/.index.db`) is derived and gitignored.
Stage + commit the source files (rebuild the index if a query looks
stale):

```bash
bun run src/index.ts sync                      # stage + commit .plot/ sources
bun run src/index.ts rebuild-index             # only if the index looks stale
```

## Acceptance

The skill is complete when **all** of the following hold:

- `bun run src/index.ts list` shows the Plot id.
- `bun run src/index.ts get plot-<id> --view implementer` exits 0 and
  the intent + attachments + events reflect the steps above.
- The seeds issue (and any informing context) appears as an attachment
  with the intended role.
- The agent's `decision_made` / `artifact_produced` events appear in the
  log, and no `intent_edited` / `status_changed` event was written by an
  `agent:*` actor.
- `bun run src/index.ts doctor` exits 0 (every file replays cleanly).
- `git status` is clean after `bun run src/index.ts sync` lands.

## Failure modes

| Symptom | Likely cause | Remedy |
|---------|--------------|--------|
| `plot append: ... agents must surface a question_posed event` | An `agent:*` actor tried an intent-mutating event. | This is the ACL working as designed — emit `question_posed` and let a human resolve it. |
| `plot append: event "status_changed" has a dedicated command` | Tried to append an event that has its own subcommand. | Use the named command (`plot status`, `plot intent`, `plot attach`, …). |
| `plot get: unknown view` | Passed a view other than `implementer`. | V1 only ships `implementer`; drop `--view` or pass `implementer`. |
| `plot ...: no Plot id` | Neither a positional id nor `PLOT_ID` was supplied. | Pass the id explicitly or `export PLOT_ID=plot-<id>`. |
| `doctor` reports a replay failure | A `.plot/` file was hand-edited or partially written. | Restore from git; never hand-edit the JSON/JSONL — use the CLI so locks + atomic writes apply. |

## Further reading

- `SPEC.md` — V1 design record (binder model, data model, write-ACL,
  views, CLI surface).
- `README.md` — user-facing pitch and command examples.
- `src/cli/router.ts` — the live subcommand surface.
- `src/acl.ts` — the write-ACL rules this skill is built around.
- `AGENTS.md` — repo-wide conventions and quality gates.

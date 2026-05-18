# Plot — Specification

> A typed, queryable, JSON-backed coordination object that holds the intent, attachments, and activity log for a unit of work — and references (does not embed) the seeds issues, agent runs, PRs, mulch records, and external sources that constitute its substance.

**Status:** Design phase, V1 spec.
**Last updated:** 2026-05-17.
**CLI:** `plot`.
**Package:** `@os-eco/plot`.

V1 scope is the **single-user binder**: structured fields, append-only event log, file-on-disk source of truth, SQLite default index, CLI for humans and agents, one hardcoded `implementer` view. Plot v1 is the substrate that warren and other os-eco tools sit on top of to coordinate multi-agent work around a unit of work.

---

## 1. Purpose & Position

Today, multi-agent coding tools center on the **run** as the primary unit: a human dispatches an agent, the agent works, the human reviews. This is the orchestrator-to-worker pattern, and it makes the human a bottleneck that translates intent through multiple hops before any code is written.

[Agentic Networks](https://www.jayminwest.com/blog/12-agentic-networks) argues the winning topology is a **network of peer nodes** sharing context, with the human as a heavily weighted node — not a manager above the agents. For that to work, there has to be a **shared substrate** all nodes can read and write, where intent lives, artifacts accumulate, and coordination becomes legible. Plot is that substrate.

Plot is intentionally a **binder, not a container.** Code lives in git. Issues live in seeds. Expertise lives in mulch. Prompts live in canopy. PRs live on GitHub. Plot holds the *coordination metadata* around a unit of work and *references* those systems with typed, role-labeled links. The substance lives in specialized systems; the Plot makes them legible together.

### 1.1 What a Plot is, in one sentence

A Plot is the place where intent meets execution: humans author it, agents query it, runs dispatch from it and report back to it, and external sources hang off it as typed attachments.

### 1.2 Where Plot fits in os-eco

| Tool   | Unit             | Role                                  |
|--------|------------------|---------------------------------------|
| Seeds  | Issue            | "This needs doing"                    |
| Mulch  | Expertise record | "This is what we know"                |
| Canopy | Prompt template  | "This is how we ask"                  |
| **Plot** | **Coordination object** | **"This is what's happening on X right now, and who/what is involved"** |

A Plot references seeds, mulch, canopy prompts, agent runs, and PRs — it does not replace any of them. Greenhouse can create Plots when triaged issues arrive. Overstory and Warren orchestrate runs against Plots. Sapling and Claude-code prime context from Plots and write events back. The data plane is unchanged; Plot adds the coordination layer.

---

## 2. Concepts

### 2.1 Plot
A single coordination object identified by `plot-<8 char base32>`. Has structured fields (intent, attachments, status) and an append-only event log. Stored as two files on disk.

### 2.2 Substrate
The collection of all Plots, their referenced attachments, and their event logs. The substrate is what makes the network topology legible — agents and humans both query it, both contribute to it, both leave provenance.

### 2.3 View
A named saved query over a Plot. V1 ships one hardcoded view (`implementer`). V2 adds configurable views. Views exist because agents must never load a full Plot — they query a view and get exactly what's relevant.

### 2.4 Actor
The identity associated with every event. Format: `user:<handle>` or `agent:<name>[:<run-id>]`. Strict regex enforcement. The actor determines write-ACL: humans can edit intent and status, agents cannot.

### 2.5 Attachment
A typed, role-labeled reference to something living in another system: a seeds issue, a mulch record, an agent run, a GitHub PR, a Slack thread, a meeting transcript. Plot stores the reference and the role; the substance stays in its native system.

---

## 3. Data Model

### 3.1 Plot file: `.plot/plot-xxx.json`

```jsonc
{
  "schema_version": 1,
  "id": "plot-abc12345",
  "name": "Add OAuth to billing portal",
  "status": "drafting",
  "created_at": "2026-05-17T10:00:00Z",
  "updated_at": "2026-05-17T14:23:00Z",

  "intent": {
    "goal": "Replace email/password auth on /billing with GitHub OAuth.",
    "non_goals": [
      "Migrating existing accounts in v1",
      "Adding other OAuth providers"
    ],
    "constraints": [
      "Must work with existing Stripe customer IDs",
      "No downtime during rollout"
    ],
    "success_criteria": [
      "New users can sign in with GitHub on /billing",
      "Existing users see a clear path forward",
      "All existing tests pass; new tests cover the OAuth flow"
    ]
  },

  "attachments": [
    {
      "id": "att-001",
      "type": "seeds_issue",
      "ref": "sd-123",
      "role": "tracks",
      "added_at": "2026-05-17T10:01:00Z",
      "added_by": "user:jw"
    }
  ]
}
```

#### Status enum
`drafting | ready | active | done | archived`

- `drafting` — intent is being authored; not ready for agent work
- `ready` — intent locked; agents can be dispatched
- `active` — agents currently executing work
- `done` — all referenced work complete
- `archived` — closed; kept for history but not surfaced by default

Only humans can transition status (write-ACL §6).

#### Intent
All fields are arrays of strings (except `goal`, which is a single string). Free text within each entry; structure comes from the field separation. Humans-only writes.

#### Attachments
- `id` — `att-<3 digit>` local to this Plot
- `type` — enumerated, extensible without schema bump
- `ref` — opaque string interpreted by the type's handler (`sd-123`, `owner/repo#789`, `mx-101`, `file://...`)
- `role` — free string but conventional: `tracks | implements | informs | discussion | meeting | reference`
- `added_at`, `added_by` — provenance

V1 attachment types: `seeds_issue | mulch_record | agent_run | gh_pr | gh_issue | file`. Adding a new type is a code change in the type handler, not a schema bump.

### 3.2 Event log: `.plot/plot-xxx.events.jsonl`

One JSON object per line, append-only, never rewritten:

```jsonl
{"type":"plot_created","actor":"user:jw","at":"2026-05-17T10:00:00Z","data":{"name":"Add OAuth to billing portal"}}
{"type":"intent_edited","actor":"user:jw","at":"2026-05-17T10:00:30Z","data":{"field":"goal","value":"..."}}
{"type":"attachment_added","actor":"user:jw","at":"2026-05-17T10:01:00Z","data":{"id":"att-001","type":"seeds_issue","ref":"sd-123","role":"tracks"}}
{"type":"status_changed","actor":"user:jw","at":"2026-05-17T11:00:00Z","data":{"from":"drafting","to":"ready"}}
{"type":"run_dispatched","actor":"agent:warren","at":"2026-05-17T11:05:00Z","data":{"run_id":"run-456","from_seed":"sd-123"}}
{"type":"decision_made","actor":"agent:claude_code:run-456","at":"2026-05-17T11:32:00Z","data":{"summary":"Using @octokit/oauth-app over hand-rolled flow","rationale":"..."}}
{"type":"question_posed","actor":"agent:claude_code:run-456","at":"2026-05-17T11:45:00Z","data":{"text":"Should existing accounts get a one-time migration prompt, or be hard-cut?","blocking":true}}
{"type":"artifact_produced","actor":"agent:claude_code:run-456","at":"2026-05-17T12:10:00Z","data":{"type":"gh_pr","ref":"owner/repo#789"}}
```

#### Event types (V1)

| Type | Emitted by | Description |
|------|------------|-------------|
| `plot_created` | CLI on init | Plot was created |
| `intent_edited` | Humans only | A field within `intent` was changed |
| `status_changed` | Humans only | Status transition |
| `attachment_added` | Anyone | Attachment added |
| `attachment_removed` | Humans only | Attachment removed |
| `run_dispatched` | Orchestrators (warren, etc.) | Agent run started from this Plot |
| `plan_run_dispatched` | Orchestrators (warren, etc.) | Multi-child plan run started from this Plot (parent of a fan-out of `run_dispatched` events) |
| `decision_made` | Agents | Agent recorded a design decision |
| `question_posed` | Agents | Agent surfaced a blocking or non-blocking question |
| `question_answered` | Humans only | Human answered an agent's question |
| `artifact_produced` | Agents | Agent produced an artifact (PR, file, etc.) |
| `note` | Anyone | Free-form annotation, body in `data.text` |

Event types are enumerable. Additive enum entries are tolerated by older readers (the replay loop ignores unknown types in its `default` branch) and do **not** require a `schema_version` bump. Removing or changing the shape of an existing type requires a schema bump.

### 3.3 ID format

- Plot: `plot-<8 char base32>` (e.g., `plot-abc12345`)
- Attachment: `att-<3 digit>` local to its Plot (e.g., `att-001`)

Matches seeds (`sd-XXX`) and mulch (`mx-XXX`) conventions.

---

## 4. Storage & File Layout

```
.plot/
  plot-abc12345.json           # structured fields, source of truth, git-tracked
  plot-abc12345.events.jsonl   # append-only log, source of truth, git-tracked
  plot-def67890.json
  plot-def67890.events.jsonl
  .index.db                  # SQLite cache, gitignored
.gitignore                   # must include .plot/.index.db
```

### 4.1 Source-of-truth invariants
- Plot files (`plot-xxx.json`) and event logs (`plot-xxx.events.jsonl`) are the **sole source of truth**.
- The SQLite index is purely derived state — `rebuild_from_files()` is always sufficient to reconstruct it.
- Nothing lives only in the index. First-time clone with no index → `rebuild()` → ready.

### 4.2 Why two files per Plot

The data model has two distinct write-frequency profiles:

| File | Write frequency | Why this format |
|------|-----------------|-----------------|
| `plot-xxx.json` | Low (intent edits, status changes, attachment add/remove) | Pretty-printed JSON with sorted keys yields clean semantic diffs in git |
| `plot-xxx.events.jsonl` | High (every agent event) | Append-only JSONL means concurrent writes from different git branches merge as concatenations — git's happy path |

Treating both the same is the source of pain. The split makes git-native storage tractable even at high event rates.

### 4.3 Branch behavior
Plot updates land on whatever branch the work happens on. When the branch merges to main, the Plot history merges with the code. Branches that abandon their work abandon their Plot updates — which is correct, since those events describe an alternate timeline.

The exception is Plot **creation, intent edits, and status changes** — these are typically authored on `main` directly, treated like a settings file. Agent branches rebase forward to pick them up.

### 4.4 Write coordination
Plot library uses file locking and atomic writes for intra-process concurrency, matching mulch/seeds conventions. Orchestrators (warren) buffer agent events and commit JSONL appends in batches (per N seconds or on run completion) to avoid per-event git commits.

---

## 5. Index

### 5.1 Interface

```ts
interface PlotIndex {
  rebuild(plotsDir: string): Promise<void>
  query(q: PlotQuery): Promise<PlotQueryResult>
  subscribe(plotId: string, onChange: () => void): Unsubscribe
}
```

### 5.2 Default implementation
`SQLitePlotIndex` — file at `.plot/.index.db`, gitignored, rebuilt on first read if missing.

### 5.3 Pluggability ("BYO db")
The interface allows alternative backends — Postgres, Supabase, DuckDB, in-memory — for hosted/shared/multi-instance deployments. The source files never change; only the index implementation does. A team running a hosted warren can share an index across instances; a solo dev gets SQLite with zero configuration.

### 5.4 Invariant
**Never put a field in the index that isn't derivable from a source file.** The index is a materialized view over the JSON + JSONL files — pure projection, no original content. First time this is violated, the "clone the repo and you have everything" story collapses.

---

## 6. Write-ACL Rules

The single hard rule: **agents may never mutate intent.**

| Event type | Allowed actors |
|------------|----------------|
| `intent_edited` | `user:*` only |
| `status_changed` | `user:*` only |
| `attachment_removed` | `user:*` only |
| `question_answered` | `user:*` only |
| `attachment_added` | Anyone |
| `run_dispatched` | Anyone (typically orchestrators) |
| `plan_run_dispatched` | Anyone (typically orchestrators) |
| `decision_made` | `agent:*` only |
| `question_posed` | `agent:*` only |
| `artifact_produced` | `agent:*` only |
| `note` | Anyone |
| `plot_created` | Anyone (typically CLI on init) |

Enforced at the library level — `Plot.append()` reads `PLOT_ACTOR` env or the configured actor and refuses prohibited combinations with a clear error message directing the agent to an allowed alternative (typically `question_posed` for "I want intent to be different").

This is the load-bearing rule for the network topology: agents are bad at surmising intent, so we make it impossible at the library level rather than advisory. An agent that thinks intent should change must surface a question for a human to answer.

---

## 7. Schema Versioning

- Every Plot file carries `schema_version` (V1: `1`).
- Migration policy: **migrate-on-read**.
- When code at schema version N reads a Plot at version M < N, it runs migrations in-memory and returns the upgraded shape. Write-back happens if/when something edits the Plot.
- Migration code accumulates and is kept forever. This is the cost we accept in exchange for branch-time-travel working — checking out a 6-month-old branch with old Plot files Just Works.

---

## 8. Views

### 8.1 V1: one hardcoded view

`implementer` returns:
- `intent` (all fields)
- Last 20 events of types: `decision_made`, `question_posed`, `question_answered`, `artifact_produced`, `note`
- Attachments where role in: `{tracks, implements, informs, reference}`

### 8.2 Why views exist
Agents must never load a full Plot. The Plot is a database; the agent queries a view and gets exactly what's relevant for its task. Without views, every agent invocation risks blowing context with irrelevant log entries.

### 8.3 V2: configurable views
Library API for declaring views; saved per-Plot or per-actor. Defer until V1 use proves what views are needed beyond `implementer`.

---

## 9. CLI Surface

### 9.1 Human-facing

```
plot init <name>                                # create new Plot, return ID
plot list                                       # list all Plots in .plot/
plot show <id>                                  # pretty-print fields + recent events
plot edit <id>                                  # open intent in $EDITOR
plot intent <id> --goal "..." --non-goal "..."  # non-interactive intent edit
plot status <id> <drafting|ready|active|done|archived>
plot attach <id> <type>:<ref> --role <role>
plot detach <id> <attachment-id>
plot answer <id> <question-id> "..."
```

### 9.2 Agent-facing

```
plot get <id> --view implementer                # surface relevant context
plot append <id> --event <type> --data <json>   # write an event
```

Agents discover their Plot ID via `PLOT_ID` env var, set by the orchestrator on dispatch. CLI calls implicitly use it unless `--plot <id>` is passed.

### 9.3 Operational

```
plot rebuild-index                              # wipe and regenerate SQLite cache
plot sync                                       # stage + commit .plot/ changes
plot doctor                                     # check file integrity, event log replay
```

---

## 10. Library Surface

```ts
import { PlotStore, SQLitePlotIndex } from '@os-eco/plot'

const store = new PlotStore({
  dir: '.plot',
  index: new SQLitePlotIndex('.plot/.index.db'),
  actor: { kind: 'user', handle: 'jw' }
})

const plot = await store.create({ name: 'Add OAuth to billing portal' })
await plot.editIntent({ goal: '...', constraints: ['...'] })
await plot.attach({ type: 'seeds_issue', ref: 'sd-123', role: 'tracks' })
await plot.setStatus('ready')

// agent side
const ctx = await store.get('plot-abc12345').view('implementer')
await store.get('plot-abc12345').append({
  type: 'decision_made',
  data: { summary: '...', rationale: '...' }
})
```

---

## 11. Out of Scope for V1

Deferred to V2+:
- `design` and `plan` sections on Plot (handled in V1 via seeds attachments)
- Provenance ledger with per-field "last_human_at" (use the event log for V1)
- Agent-proposed intent changes via a pending-changes queue (V1: agents file `question_posed` events; humans edit intent directly)
- View configuration system (V1 ships only the hardcoded `implementer` view)
- Multi-user conflict resolution (V1 is single-user; last-write-wins with the event log as authority)
- Non-SQLite index implementations (interface ships; only SQLite implementation in V1)
- Push-ingestion adapters for Slack threads, meeting transcripts, etc. (attachment types reserved in §3.1; ingestors land in V2)
- Status-tag triggers (the `ready` → planner-agent flow lands in V2 once status transitions are reliable and tested)
- Cross-Plot links / DAGs (V2)
- Web UI for Plot itself (V1: warren and other consumers render Plots; Plot ships CLI only)

---

## 12. Open Questions

These are decisions to make before or during V1 implementation:

1. **Activity log compaction**: at what size does an `events.jsonl` warrant a synopsis field that agents query in lieu of full history? Lean: never truncate, but the `implementer` view defaults to `last_30d` and a `synopsis` field is agent-maintainable.
2. **Event ordering on concurrent appends**: two agents on different branches both append to the same `events.jsonl`. Resolution: timestamp-then-actor lexicographic order on merge. Need a merge driver?
3. **Attachment validation**: does Plot verify that `sd-123` actually exists in `.seeds/` when attached, or trust the caller? V1 lean: trust, surface a warning via `plot doctor`.
4. **Actor authentication**: how does the CLI know what actor to use? Lean: `PLOT_ACTOR` env wins; falls back to `user:<git config user.email handle>`; agents always set `PLOT_ACTOR` explicitly.
5. **Schema migration path for V2 additions**: when `design` and `plan` sections land, do existing v1 Plots get them as empty objects on read, or stay v1-shaped? Lean: migrate-on-read upgrades them with empty defaults.

---

## 13. Relationship to Existing Tools

### 13.1 Seeds
A Plot **references** seeds issues as `seeds_issue` attachments. The plan for work decomposes into seeds via `sd plan` (V2 triggers a planner agent when a Plot transitions to `ready`). Seeds remains the canonical issue tracker; Plot is the coordination object around a unit of work that may span many seeds.

### 13.2 Mulch
Mulch records are referenced as `mulch_record` attachments — typically as informing context for a Plot. Agents working under a Plot prime from both the Plot's `implementer` view and from `ml prime` on relevant files.

### 13.3 Canopy
Canopy prompts are referenced as `canopy_prompt` attachments (V2) or used by orchestrators to prime agents. V1: Plot doesn't track canopy directly.

### 13.4 Warren
Warren is the primary V1 consumer of Plot. Warren dispatches agent runs from Plots, sets `PLOT_ID` in the sandbox, and surfaces Plot views in its UI. Warren's UI direction shifts from run-centric to Plot-centric (see warren's roadmap).

### 13.5 Overstory
Overstory orchestrates locally; analogous to warren's role but for tmux + git-worktree workflows. Overstory consumes Plot the same way warren does — dispatches runs from Plots, propagates events back.

### 13.6 Greenhouse
The autonomous-loop daemon. Greenhouse can create Plots when triaged issues arrive on GitHub: poll → create Plot with intent populated from the GitHub issue → set status `ready` → dispatch via warren or overstory.

### 13.7 Sapling, claude-code
Coding agents that run inside Plots. They prime from `plot get --view implementer`, emit `decision_made` / `question_posed` / `artifact_produced` events back, never touch intent.

### 13.8 Burrow
Sandbox primitive. Unaffected by Plot — Plot is a coordination layer above the runtime substrate.

---

## 14. Versioning & Release

- Version lives in `package.json` and `src/index.ts` (export `VERSION`), kept in sync.
- V0.x = experimental, breaking changes likely. Warren and other consumers pin to specific minor versions.
- V1.0 ships once the schema has stabilized through real use in warren.

---

## 15. References

- [Agentic Networks](https://www.jayminwest.com/blog/12-agentic-networks) — the topology Plot is designed to enable
- `mulch/SPEC.md`, `seeds/SPEC.md` — neighboring primitives Plot inherits patterns from
- `warren/SPEC.md` — primary V1 consumer

# Plot

A typed, queryable, JSON-backed coordination object for multi-agent work.

[![CI](https://github.com/jayminwest/plot/actions/workflows/ci.yml/badge.svg)](https://github.com/jayminwest/plot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Status:** V0.1.0 — single-user binder. See [SPEC.md](SPEC.md) for the full design and [CHANGELOG.md](CHANGELOG.md) for the release surface.

Plot is a **binder, not a container.** It holds the coordination metadata around a unit of work and *references* — with typed, role-labeled links — the seeds issues, mulch records, canopy prompts, agent runs, and PRs that constitute its substance. Code lives in git. Issues live in seeds. Expertise lives in mulch. Plot makes them legible together.

A Plot is the place where intent meets execution: humans author it, agents query it, runs dispatch from it and report back to it, and external sources hang off it as typed attachments.

## Where Plot fits in os-eco

| Tool    | Unit             | Role                                  |
|---------|------------------|---------------------------------------|
| Seeds   | Issue            | "This needs doing"                    |
| Mulch   | Expertise record | "This is what we know"                |
| Canopy  | Prompt template  | "This is how we ask"                  |
| **Plot** | **Coordination object** | **"This is what's happening on X right now, and who/what is involved"** |

Plot is the substrate that warren and other os-eco tools sit on top of to coordinate multi-agent work around a unit of work.

## Install

```bash
bun install -g @os-eco/plot-cli
```

Plot stores its source files under `.plot/` in the repo where you run it; commit those files so the Plot history rides along with the code. The SQLite index at `.plot/.index.db` is derived state and is gitignored.

## Usage

### Human authoring (SPEC §9.1)

```bash
plot init "Add OAuth to billing portal"
# → pl-abc12345

plot intent pl-abc12345 \
  --goal "Replace email/password auth on /billing with GitHub OAuth." \
  --non-goal "Migrating existing accounts in v1" \
  --constraint "Must work with existing Stripe customer IDs" \
  --success-criteria "New users can sign in with GitHub on /billing"

plot attach pl-abc12345 seeds_issue:sd-123 --role tracks
plot attach pl-abc12345 mulch_record:mx-101 --role informs

plot status pl-abc12345 ready          # drafting → ready (humans only)

plot list                              # all Plots, status, last update
plot show  pl-abc12345                 # full record + recent events
plot edit  pl-abc12345                 # opens intent JSON in $EDITOR
plot answer pl-abc12345 q-1 "no — hard cut"
plot detach pl-abc12345 att-002
```

Each command accepts `--json` (machine output) where it makes sense.

### Agent integration (SPEC §9.2)

Orchestrators (warren, overstory) dispatch agents with `PLOT_ID` and `PLOT_ACTOR` set in the environment:

```bash
export PLOT_ID=pl-abc12345
export PLOT_ACTOR=agent:claude:run-456

plot get --view implementer            # primes context — no full event log

plot append --event decision_made \
  --data '{"summary":"use @octokit/oauth-app","rationale":"spec-aligned"}'

plot append --event question_posed \
  --data '{"text":"Migrate existing accounts?","blocking":true}'

plot append --event artifact_produced \
  --data '{"type":"gh_pr","ref":"owner/repo#789"}'
```

The library refuses agent-issued `intent_edited`, `status_changed`, and `attachment_removed` events (SPEC §6 write-ACL) and points the caller at `question_posed` — agents that want intent to change must surface a question for a human to answer.

### Operational (SPEC §9.3)

```bash
plot sync           # stage + commit .plot/*.json and *.events.jsonl
plot rebuild-index  # wipe and regenerate .plot/.index.db from source files
plot doctor         # check file integrity + event log replay
```

`.plot/.index.db` is gitignored and always rebuildable from the JSON + JSONL source files (SPEC §4.1, §5.4).

### Library API (SPEC §10)

```ts
import { PlotStore, SQLitePlotIndex } from "@os-eco/plot-cli";

const store = new PlotStore({
  dir: ".plot",
  index: new SQLitePlotIndex(".plot/.index.db"),
  actor: { kind: "user", handle: "jw", raw: "user:jw" },
});

const plot = await store.create({ name: "Add OAuth to billing portal" });
await plot.editIntent({ goal: "...", constraints: ["..."] });
await plot.attach({ type: "seeds_issue", ref: "sd-123", role: "tracks" });
await plot.setStatus("ready");

// Agent side — orchestrator constructs the store with an agent actor.
const view = await store.get("pl-abc12345").view("implementer");
await store
  .get("pl-abc12345")
  .append({ type: "decision_made", data: { summary: "...", rationale: "..." } });
```

### Environment

| Var          | Purpose                                                                    |
|--------------|----------------------------------------------------------------------------|
| `PLOT_DIR`   | Plot directory (default: `.plot`)                                          |
| `PLOT_ACTOR` | Override actor (`user:<handle>` or `agent:<name>[:<run-id>]`)              |
| `PLOT_ID`    | Default Plot ID for agent commands (`plot get`, `plot append`)             |
| `PLOT_DEBUG` | Set to `1` to print stack traces on error                                  |

## Development

```bash
git clone https://github.com/jayminwest/plot
cd plot
bun install
bun link              # Makes 'plot' available globally
```

### Build & Test

```bash
bun test              # Run all tests (includes acceptance integration suite)
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Tech Stack

- **Runtime:** Bun (runs TypeScript directly, no build step)
- **Language:** TypeScript with strict mode (`noUncheckedIndexedAccess`, no `any`)
- **Linting:** Biome (formatter + linter in one tool)
- **Storage:** JSON files on disk (`.plot/pl-*.json`), append-only event log per Plot (`.plot/pl-*.events.jsonl`), SQLite index (`.plot/.index.db`, gitignored)

## Documentation

- [SPEC.md](SPEC.md) — v1 specification
- [CHANGELOG.md](CHANGELOG.md) — release history
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor guide
- [SECURITY.md](SECURITY.md) — security policy

## License

[MIT](LICENSE) © Jaymin West

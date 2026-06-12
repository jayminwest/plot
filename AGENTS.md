# AGENTS.md

This file is the canonical entry point for AI coding agents working in
the plot repo, following the [agents.md](https://agents.md) convention.
It mirrors the essentials from `CLAUDE.md`; when the two disagree,
`CLAUDE.md` is authoritative and this file should be updated to match.

## What this project is

**Plot** is a typed, queryable, JSON-backed **coordination object** for
multi-agent work. A Plot is a *binder, not a container*: it holds the
intent, attachments, and append-only activity log for a unit of work,
and it *references* — rather than embeds — the seeds issues, mulch
records, canopy prompts, agent runs, and GitHub PRs that constitute its
substance. Code lives in git; issues live in seeds; expertise lives in
mulch; PRs live on GitHub. Plot is the layer that makes those systems
legible *together* around one unit of work.

The on-disk model is the source of truth and is deliberately split into
two files per Plot:

- `.plot/<id>.json` — structured fields (intent, status, attachments),
  pretty-printed with sorted keys so edits yield clean semantic git
  diffs. Low write frequency.
- `.plot/<id>.events.jsonl` — append-only event log, one JSON object
  per line, never rewritten. High write frequency; concurrent appends
  from different branches merge as concatenations (git's happy path).

A SQLite **index** (`.plot/.index.db`, gitignored) is a pure
materialized view over those files — never a source of original data.
It is rebuilt from the source files on first read if missing, so a
fresh clone with no index Just Works.

The load-bearing rule for the whole design: **agents may never mutate
intent.** Intent edits, status transitions, attachment removal, and
question answers are `user:*`-only and enforced at the library level
(`src/acl.ts`). An agent that thinks intent should change must file a
`question_posed` event for a human, never edit intent directly.

Plot is part of the **os-eco** ecosystem alongside warren (control
plane), burrow (sandbox), mulch (expertise), seeds (issues), canopy
(prompts), and sapling (runtime). Warren is the primary V1 consumer.
See `SPEC.md` for the full design record.

## Tech stack at a glance

- **Runtime:** Bun (runs TypeScript directly; no build step on the CLI).
- **Language:** TypeScript with strict mode (`noUncheckedIndexedAccess`,
  no `any`).
- **Lint / format:** Biome (`biome.json`). Warnings fail the build
  (`--error-on-warnings`); the `useFilenamingConvention` rule enforces
  strict kebab-case filenames.
- **Tests:** `bun test` discovers `*.test.ts` under `src/` (test root is
  pinned to `src` in `bunfig.toml`); tests live next to the file under
  test (e.g. `src/store.test.ts`, `src/cli/router.test.ts`).
- **Storage:** per-Plot JSON + JSONL files under `.plot/` are the sole
  source of truth; the SQLite index (`.plot/.index.db`) is derived state.
- **CLI:** `plot` (entry point `src/index.ts`, dispatched through the
  flat command map in `src/cli/router.ts`).

## Project layout

```
plot/
├── src/
│   ├── index.ts            # plot CLI entry point + library exports
│   ├── version.ts          # export const VERSION (release source of truth)
│   ├── io.ts               # atomic file read/write helpers
│   ├── lock.ts             # advisory file locking for concurrent writers
│   ├── store.ts            # PlotStore: create / load / mutate Plots
│   ├── plot-index.ts       # PlotIndex interface (pluggable backend)
│   ├── sqlite-index.ts     # default SQLitePlotIndex (derived view)
│   ├── acl.ts              # write-ACL enforcement (intent is human-only)
│   ├── actor.ts            # actor parsing (user:* / agent:*)
│   ├── schemas.ts          # Plot + event schema definitions
│   ├── types.ts            # shared types
│   ├── migrations.ts       # migrate-on-read schema upgrades
│   ├── views.ts            # the hardcoded `implementer` view
│   └── cli/
│       ├── router.ts       # subcommand dispatch + help
│       ├── runtime.ts      # CliContext / IO / env plumbing
│       ├── format.ts       # human + JSON output helpers
│       └── commands/       # one file per subcommand
├── scripts/                # quality-gate scripts + reporters
│   ├── check-all.ts            # canonical quiet runner (byte-identical fleet-wide)
│   ├── check-ci-parity.ts      # CI <-> check:all parity gate (byte-identical fleet-wide)
│   ├── ci-parity-config.json   # sanctioned CI-only / alias escape hatches
│   ├── validate-agents-md.ts   # validates this file's references
│   ├── check-file-sizes.ts
│   ├── check-debt-markers.ts
│   ├── check-coverage.ts
│   ├── report-test-timing.ts
│   ├── report-quality-metrics.ts
│   └── version-bump.ts         # bump package.json + src/version.ts in sync
├── budgets/                # ratchet budgets (coverage, file-size, debt)
│   ├── coverage-budgets.json
│   ├── file-size-budgets.json
│   └── debt-markers-budget.json
├── .plot/                  # plot's own coordination data (dogfood)
├── .factory/skills/        # repo-local agent skills
├── .github/workflows/      # ci.yml + publish.yml + auto-merge.yml
├── SPEC.md                 # V1 design record
├── README.md               # user-facing pitch
├── CHANGELOG.md            # release history
├── RUNBOOK.md              # release / triage / rollback procedures
├── CLAUDE.md               # authoritative onboarding doc
├── biome.json
├── bunfig.toml
├── tsconfig.json
└── package.json
```

## Commands

All commands run from the repo root unless noted. Bun must be on `PATH`.

```bash
bun install                       # install dependencies
bun test                          # run all tests (rooted at src/)
bun test src/store.test.ts        # run a single test file
bun run lint                      # biome check --error-on-warnings .
bun run lint:fix                  # biome check --write --error-on-warnings .
bun run typecheck                 # tsc --noEmit
bun run test:ci                   # bun test with coverage (lcov) + junit reporters
```

Quality gates (each lives in `scripts/`):

```bash
bun run verify                    # agent-facing entry point (alias of check:all)
bun run check:all                 # scripts/check-all.ts — canonical quiet runner, all 9 gates
bun run check:size                # scripts/check-file-sizes.ts
bun run check:debt                # scripts/check-debt-markers.ts
bun run check:dups                # jscpd duplication budget
bun run check:deps                # knip unused/undeclared dependency check
bun run check:coverage            # scripts/check-coverage.ts
bun run check:agents              # scripts/validate-agents-md.ts (this file)
bun run check:ci-parity           # scripts/check-ci-parity.ts — CI <-> check:all parity
bun run report:test-timing        # slowest suites/tests from junit.xml
bun run report:quality-metrics    # consolidated quality summary
bun run version:bump              # scripts/version-bump.ts <major|minor|patch>
```

`check:all` is the os-eco fleet's canonical quiet runner (see
docs/check-all-standard.md at the os-eco meta-repo root). It runs the
nine core gates in canonical order — `lint`, `typecheck`,
`check:agents`, `check:dups`, `check:deps`, `check:size`, `check:debt`,
`check:coverage`, `check:ci-parity` — printing one aligned line per
gate and a final tally. On failure it prints parsed failure signatures
plus a `re-run` hint; `CHECK_ALL_VERBOSE=1` streams full output and
`--bail` stops at the first failure. `scripts/check-all.ts` and
`scripts/check-ci-parity.ts` are byte-identical fleet-wide — never edit
them in place; per-repo variation lives in `package.json` and
`scripts/ci-parity-config.json`.

Each gate either passes silently (or prints a short summary) or prints a
remediation pointer and exits non-zero. The ratchet scripts
(`check:size`, `check:debt`, `check:coverage`) read JSON budgets from
`budgets/`; the budgets are baselined from the repo's current state and
only tighten over time (size + debt move down, coverage moves up).

User-facing `plot` reference:

```bash
bun src/index.ts --help           # top-level help + command list (dev)
bun src/index.ts <cmd> --help     # per-command usage (dev)
bunx plot --help                  # same, once installed from npm
```

The full subcommand surface (human / agent / operational) is defined in
the flat command map in `src/cli/router.ts` and documented in `SPEC.md`
§9. Key commands:

- **Human-facing:** `plot init`, `plot list`, `plot show`, `plot edit`,
  `plot intent`, `plot status`, `plot attach`, `plot detach`,
  `plot answer`.
- **Agent-facing:** `plot get` (render a view, default JSON),
  `plot append` (write an event).
- **Operational:** `plot rebuild-index`, `plot sync`, `plot doctor`.

Agents discover their target Plot via the `PLOT_ID` env var (set by the
orchestrator on dispatch); `PLOT_ACTOR` sets the write identity and
`PLOT_DIR` overrides the data directory.

## Conventions

### Filenames & directories

- Source files: `kebab-case.ts`. Tests are `<name>.test.ts` next to the
  file under test (e.g. `src/sqlite-index.test.ts`).
- Directories: `kebab-case` (`src/cli/commands`, `scripts`).
- The filename rule is enforced by Biome's
  `style.useFilenamingConvention` (strict kebab-case) in `biome.json`.
- The illustrative placeholder `kebab-case.ts` appears in this file only
  as a naming-convention example; it is not a real file.

### CLI command layout

- One file per subcommand under `src/cli/commands/<name>.ts`, registered
  in the flat `COMMANDS` map in `src/cli/router.ts`.
- Command handlers receive a `CliContext` (`src/cli/runtime.ts`) and
  return a numeric exit code. They never `console.log` directly —
  output goes through the helpers in `src/cli/format.ts` so the `--json`
  contract stays consistent.
- Agent-facing commands (`plot get`, `plot append`) resolve the target
  Plot ID from an explicit `--plot` flag, then `PLOT_ID`, in that order.

### TypeScript

- Strict mode with `noUncheckedIndexedAccess` — always handle possible
  `undefined` from indexing.
- No `any`; use `unknown` and narrow, or define a proper type
  (`noExplicitAny` is an error in `biome.json`).
- No non-null assertions (`noNonNullAssertion` is an error).
- Import with explicit `.ts` extensions (Bun + Node ESM compatibility);
  use `import type` for type-only imports.
- Tab indentation, 100-char line width. Biome enforces both.

### Test naming

- `describe("<unitUnderTest>")` + `test("verb-led behaviour
  description")`. No `should`, no `it`.
- Co-locate tests with the file under test. Acceptance-driven
  integration tests live in `src/integration.test.ts` and exercise the
  SPEC §3 acceptance criteria end to end.

### Debt markers

Every `TODO` / `FIXME` / `HACK` / `XXX` on a source line must carry a
tracker reference on the same line. Accepted prefixes (see
`budgets/debt-markers-budget.json` `trackerPatterns`):

- `pl-XXXX` — repo-local plot tracker (debt-marker ref).
- `mx-XXXX` — cross-repo mission tracker.
- `#NNN` — GitHub issue.
- A URL (any http link) — external reference.

Note: seeds issue IDs are `plot-XXXX` (e.g. the seed that tracks this
work), which is distinct from the `pl-XXXX` debt-marker prefix.
`bun run check:debt` fails the build on bare markers.

### Log scrubbing

Diagnostics flow through a [pino](https://github.com/pinojs/pino) logger in
`src/log.ts`, distinct from the user-facing command output that goes through
`src/cli/format.ts` and the injected `CliIO` streams. The logger sits at the
`info` level and emits JSON by default; setting `PLOT_DEBUG=1` drops it to
`debug` and routes through `pino-pretty` for readable terminal output. This is
the same activation env var the CLI documents (`plot --help` → `PLOT_DEBUG`);
no new flag was introduced. The router's error path logs the full stack +
context through `log.debug` under `PLOT_DEBUG=1` rather than printing it to
stderr directly.

Secrets must never reach any log sink — npm tokens, GitHub PATs, API keys,
passwords, and auth/cookie headers. `src/log.ts` configures pino's `redact`
with `censor: "[REDACTED]"` over these paths (`REDACT_PATHS`):

- `token`, `apiKey`, `password`, `secret` — bare root-level keys.
- `*.token`, `*.apiKey`, `*.password`, `*.secret` — the same keys one level
  deep under any object. pino's path syntax does not support `**.key`, so each
  secret key is listed in both the bare and `*.key` wildcard form to cover the
  common shapes conservatively.
- `headers.authorization`, `headers.cookie` — request-context headers.

`src/log.test.ts` asserts these are scrubbed (root, one-level-nested, and
header forms) and that non-sensitive fields pass through untouched.

### Configuration

The Plot data directory defaults to `.plot/` and can be overridden with
`PLOT_DIR`. Mutations go through `src/store.ts`, which acquires an
advisory file lock (`src/lock.ts`) and writes atomically (`src/io.ts`)
so parallel agents in different worktrees never corrupt the JSON/JSONL.
The SQLite index (`.plot/.index.db`) is gitignored and rebuilt from
source files on demand.

## Testing & Validation

### Per-change verification

Before committing any code change, run all of the following from the
repo root:

```bash
bun run verify
```

`verify` is the agent-facing alias of `bun run check:all` — the
canonical quiet runner described in the Commands section. All nine
gates must pass. CI runs the same `bun run check:all` (see
`.github/workflows/ci.yml`); local greens are the contract, and the
`check:ci-parity` gate proves CI and the local gate set stay
equivalent. To iterate on a single gate, re-run it directly (e.g.
`bun run check:coverage` or `bun test src/store.test.ts`).

### Coverage discipline

`bun run check:coverage` enforces the per-file floors in
`budgets/coverage-budgets.json` against Bun's coverage reporter. The
ratchet only goes **up**: when coverage improves, edit the budget upward
in the same commit. Lowering a floor requires deleting tests and a
tracker reference in the commit body so the reviewer can audit it.

### File-size and debt ratchets

`bun run check:size` and `bun run check:debt` read
`budgets/file-size-budgets.json` and `budgets/debt-markers-budget.json`
respectively. The ratchet only goes **down**: a listed file may shrink
(or drop off once below the global cap) but not grow. Refactor before
raising a budget; if you must raise one, justify it in the commit body
and link the tracker id.

### AGENTS.md validation

`bun run check:agents` runs `scripts/validate-agents-md.ts`, which
parses this file and asserts:

1. Every `bun run <X>` token inside a fenced bash block is defined in
   `package.json`'s `scripts` map.
2. Every backticked path-shaped token resolves on disk (relative to the
   repo root), except for the explicit known-missing allowlist in
   `scripts/validate-agents-md.ts` (build artifacts like
   `coverage/lcov.info`, gitignored CI outputs like
   `test-results/junit.xml`, the derived index `.plot/.index.db`, and
   naming-convention placeholders like `kebab-case.ts`).

When this check fails, fix the broken reference in the same commit — do
not silently extend the allowlist.

### CI parity

`.github/workflows/ci.yml` runs `bun run check:all` (all nine gates)
plus `bun run test:ci` (the same suite as `check:coverage`, re-run with
junit + lcov reporters for artifact uploads) on push to `main` and on
every pull request. `bun run check:ci-parity` enforces that every
`bun run <X>` step in ci.yml is reachable from the `check:all`
manifest; the only sanctioned divergences are the justified `aliases` /
`ciOnly` entries in `scripts/ci-parity-config.json`. The release workflow
`.github/workflows/publish.yml` re-runs the same suite, then publishes
to npm and creates a GitHub release from the matching `CHANGELOG.md`
section. Operational procedures for releases live in `RUNBOOK.md`.

## Agent Workflow

When an agent works in plot, it should:

1. **Prime context.** Read this file (`AGENTS.md`), `CLAUDE.md`,
   `SPEC.md`, and the latest `CHANGELOG.md` entry. Run `ml prime` (mulch)
   and `sd prime` (seeds) if those tools are the active project context.
2. **Find unblocked work.** Use the repo's issue tracker (Seeds:
   `sd ready`; GitHub: `gh issue list`).
3. **Make focused changes.** One concern per commit. Preserve existing
   conventions — adapt, do not overwrite.
4. **Run gates locally.** `bun run verify` (the `check:all` quiet
   runner) must exit 0 before commit.
5. **Pin debt markers.** Any new `TODO` / `FIXME` must reference a
   tracker id (`pl-XXXX`, `mx-XXXX`, `#NNN`, or a URL) on the same line.
6. **Respect the write-ACL.** When working *through* a Plot (not on the
   plot codebase), never emit `intent_edited` / `status_changed` as an
   agent — file a `question_posed` event instead.
7. **Commit & sync.** Commit message follows `<area>: <summary>`
   (e.g. `quality: ratchet file-size cap`, `feat: add plot answer`). Do
   not `git push` unless the user asks; leave commits local.
8. **Record insights.** If the project uses Mulch, `ml record` any
   convention discovered or failure encountered.

### Working through a Plot (dogfood)

Plot uses plot: `.plot/` holds plot's own coordination objects. There is
a repo-local skill at
`.factory/skills/plot-coordination/SKILL.md` that walks an agent through
binding a run to a Plot (`plot init` → `plot attach` → `plot get` →
`plot append`) with explicit acceptance criteria. Load it whenever you
need to coordinate work through a Plot from a cold start.

### Session completion protocol

Before ending a session:

1. File issues for remaining work (`sd create --title "..."`).
2. Run the gate suite above.
3. Close finished issues (`sd close <id>`).
4. Record session insights (`ml record <domain> ...`).
5. Push only when the user requests it; otherwise leave commits local.
6. Verify `git status` is clean.

## Version management

Plot's version lives in **two** places, kept in sync (the
`version:bump` script edits both atomically; `.github/workflows/publish.yml`
verifies they agree before publishing):

- `package.json` — `"version"` field.
- `src/version.ts` — `export const VERSION = "X.Y.Z"` (re-exported from
  `src/index.ts`).

```bash
bun run version:bump patch        # bump both files; then edit CHANGELOG.md
```

Detailed release procedures — including triage of a failed publish and
rollback — live in `RUNBOOK.md`.

## Further reading

- `CLAUDE.md` — authoritative onboarding / convention doc.
- `SPEC.md` — V1 design record (binder model, data model, index, ACL).
- `README.md` — user-facing pitch + install instructions.
- `RUNBOOK.md` — release, triage, and rollback procedures.
- `CHANGELOG.md` — release history.
- `src/cli/router.ts` — the live subcommand surface.
- `.factory/skills/plot-coordination/SKILL.md` — repo-local agent skill
  for binding a run to a Plot.

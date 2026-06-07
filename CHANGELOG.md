# Changelog

All notable changes to Plot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] — 2026-06-07

### Fixed
- **CLI help drift (`src/cli/router.ts`):** corrected the top-level help so the
  `--json` flag is described under the commands that actually support it rather
  than as a global option, and fixed the `PLOT_DEBUG` env var description to
  match its real behavior (drops the logger to `debug` and routes through
  `pino-pretty`). Documentation-only change to the rendered help text; no
  behavioral change to any command.

## [0.4.0] — 2026-05-28

Level-5 agent-readiness uplift. No change to the CLI surface or SPEC behavior —
this release adds the engineering substrate (quality ratchets, structured
diagnostics, governance docs, CI) that makes Plot safe for autonomous agents to
work in. Ported from the canonical `templates/l5-toolkit/` tree and adapted to
this repo.

### Added
- **Structured logger (`src/log.ts`):** a pino instance gated on `PLOT_DEBUG`,
  separate from the user-facing `CliIO` output channel. Defaults to `info`/JSON;
  `PLOT_DEBUG=1` drops it to `debug` and routes through `pino-pretty`. Includes
  defense-in-depth redaction of secrets (tokens, API keys, passwords, auth/cookie
  headers) so credentials never reach a log sink. The router now routes the full
  failure diagnostic (stack + context) through this logger instead of the user
  stream.
- **Quality ratchets:** `check-file-sizes`, `check-debt-markers`, and
  `check-coverage` scripts with co-located tests and JSON budget files under
  `budgets/`, plus `report-quality-metrics` and `report-test-timing` reporters.
- **Governance & docs:** `AGENTS.md` (with a `validate-agents-md` validator),
  `RUNBOOK.md`, the `plot-coordination` `.factory` skill, `.github/dependabot.yml`,
  and an expanded CI workflow wiring the new `check:*` aggregator.
- **Tooling baselines:** Biome, knip, jscpd (`.jscpd.json`), bunfig, a
  `.devcontainer/`, a `pre-commit` hook (`scripts/hooks/`), and a stricter
  `tsconfig`.

### Changed
- **`README`:** dropped overstory from the active-orchestrator references.

## [0.3.1] — 2026-05-28

### Changed
- **CLI `--json` output (SPEC §11):** standardized JSON output across all CLI
  commands — every `--json` response now goes through a single formatter that
  emits a trailing newline and uses consistent stringify settings, so shell
  pipelines (`jq`, line-oriented readers) no longer see commands that omit the
  final newline.
- **`plot status` error prefix:** invalid-status errors are now prefixed with
  the command name (`plot status: ...`) to match the rest of the CLI's error
  reporting style.

### Fixed
- **`plot doctor` replay (SPEC §8):** malformed `intent_edited` payloads are
  now flagged as replay errors instead of being silently coerced. Previously a
  bad payload could survive `doctor` clean; it now surfaces as a structured
  failure with the offending event's index.

## [0.3.0] — 2026-05-18

### Added
- **Event type (SPEC §3.2, §6):** `plan_run_dispatched` — orchestrators (warren
  et al.) emit this when they launch a multi-child plan run against a Plot.
  Sits alongside `run_dispatched` (single-child dispatch); shares the
  `[user, agent]` write-ACL. Payload: `{ plan_run_id, plan_id, children_count }`.
  Additive enum entry — no `schema_version` bump (old readers tolerate unknown
  event types via the replay loop's `default` branch).

## [0.2.0] — 2026-05-17

### Changed
- **BREAKING (SPEC §3.3):** Plot ID prefix renamed from `pl-` to `plot-`. New format:
  `plot-<8 lowercase alphanumeric>` (e.g., `plot-abc12345`). Eliminates collision
  with seeds plan IDs (`pl-<4 hex>`), which can share the same prefix when both
  appear in an agent context (warren integrates both as opt-in features). Old
  `pl-<8>` IDs are now rejected by `isPlotId` / `assertPlotId` and by the JSON
  schema. The one in-repo Plot fixture was renamed in this release; downstream
  consumers (warren) must regenerate any persisted `pl-<id>` references.

## [0.1.1] — 2026-05-17

No functional changes. Re-release to recover the initial npm publish after the
0.1.0 version slot on `@os-eco/plot-cli` was blocked from republishing.

## [0.1.0] — 2026-05-17

First usable release: the **single-user binder** scope from SPEC §3–§10. A human can
author a Plot, attach references, transition status, and an agent can prime context
and append events under enforced write-ACL.

### Added
- **Data model (SPEC §3, §4):** `Plot` and event types, JSON schema, on-disk layout
  with `.plot/plot-<id>.json` (intent + attachments) and `.plot/plot-<id>.events.jsonl`
  (append-only event log) as the sole source of truth.
- **File IO (SPEC §4.4):** atomic JSON writes (`tmp` + `rename`), JSONL append,
  cross-process file locking (`.lock` sentinel) so concurrent agents don't corrupt
  the log.
- **PlotIndex (SPEC §5):** `PlotIndex` interface + `SQLitePlotIndex`
  (`.plot/.index.db`, gitignored). Index is purely derived — `plot rebuild-index`
  reproduces every queryable field from the JSON + JSONL source.
- **PlotStore library API (SPEC §10):** `create` / `get` / `editIntent` / `attach` /
  `detach` / `append` / `setStatus`, exported alongside `SQLitePlotIndex` from
  `@os-eco/plot-cli`.
- **Write-ACL enforcement (SPEC §6):** humans own intent, status, and attachment
  removal; agents own everything else. Agent-issued `intent_edited`,
  `status_changed`, and `attachment_removed` events are refused with a pointer to
  `question_posed`.
- **Schema versioning (SPEC §7):** every file carries `schema_version: 1`; a
  migrate-on-read registry runs (no-op in v1) and is exercised by a synthetic
  legacy fixture so the chain is verified.
- **Hardcoded `implementer` view (SPEC §8.1):** intent + last 20 events filtered to
  `{decision_made, question_posed, question_answered, artifact_produced, note}` +
  attachments whose role ∈ `{tracks, implements, informs, reference}`.
- **Human-facing CLI (SPEC §9.1):** `plot init`, `intent`, `attach`, `detach`,
  `status`, `list`, `show`, `edit`, `answer`. `--json` machine output where it
  makes sense.
- **Agent-facing CLI (SPEC §9.2):** `plot get --view implementer` and
  `plot append --event <type> --data <json>`. `PLOT_ID` / `PLOT_ACTOR` env
  conventions; `plot append` rejects events that have dedicated subcommands.
- **Operational CLI (SPEC §9.3):** `plot rebuild-index`, `plot sync`, `plot doctor`
  (file integrity + event log replay).
- **Integration tests:** `src/integration.test.ts` exercises the SPEC §3 plan
  acceptance criteria end-to-end (human flow, agent flow, ACL rejection, rebuild
  reproducibility, schema-versioning chain, implementer view filtering).
- **README usage examples + `.gitignore` wiring** for `.plot/.index.db` and lock
  sentinels.
- Initial repository scaffold: Bun + Biome + TypeScript, CI + publish workflows,
  release flow, contribution and security docs.

### Known limitations
- Concurrent JSONL appends on different git branches order by timestamp-then-actor
  on merge (SPEC §12.2). No git merge driver ships in v0.1.0 — consumers (warren,
  overstory) should be aware.
- Attachment refs are not live-validated; `plot doctor` surfaces broken refs as
  warnings (SPEC §12.3).
- Only the hardcoded `implementer` view is available. Configurable views are
  deferred (SPEC §8.3, §11).
- SQLite is the only `PlotIndex` backend in v0.1.0 (SPEC §5, §11).
- Design/plan sections, multi-user ACL, push ingestors, status-tag triggers,
  cross-Plot DAGs, and the web UI are all deferred to V2 per SPEC §11.

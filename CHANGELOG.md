# Changelog

All notable changes to Plot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-17

First usable release: the **single-user binder** scope from SPEC §3–§10. A human can
author a Plot, attach references, transition status, and an agent can prime context
and append events under enforced write-ACL.

### Added
- **Data model (SPEC §3, §4):** `Plot` and event types, JSON schema, on-disk layout
  with `.plot/pl-<id>.json` (intent + attachments) and `.plot/pl-<id>.events.jsonl`
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

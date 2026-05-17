# Plot

A typed, queryable, JSON-backed coordination object for multi-agent work.

[![CI](https://github.com/jayminwest/plot/actions/workflows/ci.yml/badge.svg)](https://github.com/jayminwest/plot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Status:** Design phase (v1 spec). See [SPEC.md](SPEC.md) for the full design. CLI is not yet implemented.

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

> Not yet published. Once a `0.0.1` release lands:

```bash
bun install -g @os-eco/plot-cli
```

## Development

```bash
git clone https://github.com/jayminwest/plot
cd plot
bun install
bun link              # Makes 'plot' available globally once src/index.ts is implemented
```

### Build & Test

```bash
bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Tech Stack

- **Runtime:** Bun (runs TypeScript directly, no build step)
- **Language:** TypeScript with strict mode (`noUncheckedIndexedAccess`, no `any`)
- **Linting:** Biome (formatter + linter in one tool)
- **Storage:** JSON files on disk (`.plot/pl-*.json`), append-only event log per Plot, optional SQLite index

## Documentation

- [SPEC.md](SPEC.md) — v1 specification
- [CHANGELOG.md](CHANGELOG.md) — release history
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor guide
- [SECURITY.md](SECURITY.md) — security policy

## License

[MIT](LICENSE) © Jaymin West

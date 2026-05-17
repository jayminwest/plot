# Contributing to Plot

Thanks for your interest in contributing to Plot! This guide covers everything you need to get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/plot.git
   cd plot
   ```
3. **Install** dependencies:
   ```bash
   bun install
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b fix/description-of-change
   ```

## Branch Naming

Use descriptive branch names with a category prefix:

- `fix/` -- Bug fixes
- `feat/` -- New features
- `docs/` -- Documentation changes
- `refactor/` -- Code refactoring
- `test/` -- Test additions or fixes

## Build & Test Commands

```bash
bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

Always run all three before submitting a PR.

## Coding Conventions

- **Tab indentation** (enforced by Biome)
- **100 character line width** (enforced by Biome)
- Strict TypeScript with `noUncheckedIndexedAccess` — always handle possible `undefined`
- No `any` — use `unknown` and narrow, or define proper types
- All relative imports use `.ts` extensions
- Tests use real filesystems (temp dirs via `mkdtemp`), never mocks

## Testing

- **Framework:** `bun test` (built-in, Jest-compatible API)
- Tests colocated with source: `src/foo.test.ts` next to `src/foo.ts`
- Use real I/O with temp directories, no mocks

## Pull Request Expectations

- **One concern per PR.** Keep changes focused.
- **Tests required.** New features and bug fixes should include tests.
- **Passing CI.** All PRs must pass CI checks before merge.
- **Description.** Briefly explain what and why. Link relevant issues.

## Reporting Issues

Use [GitHub Issues](https://github.com/jayminwest/plot/issues) for bug reports and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

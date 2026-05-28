# Plot Operations Runbook

This runbook covers plot's operational procedures only:

1. Cutting a release of `@os-eco/plot-cli` to npm.
2. Triaging a failed publish.
3. Rolling back a bad release.

For day-to-day development conventions, see `AGENTS.md`. For the design
record, see `SPEC.md`.

## Pre-flight (do once per machine)

- `bun --version` ≥ the version in `package.json` `engines.bun` (≥ 1.0).
- `gh auth status` → authenticated, with `repo` + `workflow` scopes.
- `git remote -v` shows the canonical origin
  (`github.com/jayminwest/plot`).
- For npm publish: `npm whoami` → `jayminwest`; 2FA enabled on the
  account. (The workflow publishes with `--provenance`, so npm
  trusted-publishing / OIDC must be configured on the package.)
- Local working tree on `main`, fully up to date, `git status` clean.

The publish flow is fully automated via `.github/workflows/publish.yml`.
You should not need to invoke `npm publish` manually for a normal
release.

## 1. Release procedure

Cut releases from `main` only. Never tag a feature branch.

### 1.1 Decide the version

Follow [SemVer](https://semver.org). Pick:

- **MAJOR** for any backward-incompatible change to the `plot` public
  CLI surface (subcommand removed, flag renamed) or a breaking change to
  the on-disk Plot JSON / event-log schema.
- **MINOR** for new features or non-breaking additions (new subcommand,
  new optional flag, new attachment type, additive event type).
- **PATCH** for bug fixes, doc-only changes, internal refactors,
  dependency bumps that don't change plot's surface.

While plot is pre-1.0 (current `package.json` `"version"` starts with
`0.`), breaking changes go in MINOR; additive changes go in PATCH.

### 1.2 Bump the version in every source of truth

Plot's version lives in **two** places, kept in sync. The publish
workflow asserts they agree before pushing to npm:

- `package.json` — `"version"` field.
- `src/version.ts` — `export const VERSION = "X.Y.Z"` (re-exported by
  `src/index.ts`).

The `version:bump` script edits both atomically (and rolls
`package.json` back if `src/version.ts` can't be updated):

```bash
bun run version:bump patch       # or: minor | major
git diff package.json src/version.ts   # confirm only the version moved
```

### 1.3 Update the changelog

`CHANGELOG.md` must have a new entry at the top under a `## [X.Y.Z] —
YYYY-MM-DD` heading. The publish workflow extracts this section verbatim
(via an awk script keyed on `## [X.Y.Z]`) and uses it as the GitHub
release body, so the heading format matters.

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- Short description (pl-XXXX).

### Changed
- Short description.

### Fixed
- Short description (#NNN).
```

Group changes under standard Keep-a-Changelog headings (Added /
Changed / Fixed / Deprecated / Removed / Security). Link each entry to
its `pl-XXXX` tracker id, `mx-XXXX` cross-repo id, `#NNN` GitHub issue,
or a URL.

### 1.4 Final gate check

```bash
bun install
bun run lint
bun run typecheck
bun test
bun run check:agents
```

All must exit 0. If any fails, **stop** — fix locally and re-run before
continuing. Run the ratchets too (`bun run check:size`,
`bun run check:debt`, `bun run check:coverage`).

### 1.5 Commit and push to `main`

```bash
git add package.json src/version.ts CHANGELOG.md
git commit -m "release: plot X.Y.Z"
git push origin main
```

`.github/workflows/publish.yml` triggers on a push to `main` that
touches `package.json` or `CHANGELOG.md` (and is also runnable via
`workflow_dispatch`). It:

1. Re-runs `bun run lint`, `bun run typecheck`, and `bun test` in CI.
2. Compares `package.json` `"version"` against the npm registry's
   current version of `@os-eco/plot-cli`. If they match, the workflow
   short-circuits (`publish=false`); otherwise it proceeds.
3. Asserts `package.json` and `src/version.ts` agree on `X.Y.Z`.
4. Publishes `@os-eco/plot-cli@X.Y.Z` to npm with `--access public
   --provenance`.
5. Tags `vX.Y.Z` and pushes the tag to origin.
6. Extracts the matching `CHANGELOG.md` section and uses it as the
   GitHub release body. If the section is empty, the workflow falls back
   to `gh release --generate-notes`.

Watch the workflow run live:

```bash
gh run watch
```

### 1.6 Post-release sanity

After the workflow finishes:

```bash
git pull --tags
git tag --list | tail -5                       # confirm vX.Y.Z present
gh release view vX.Y.Z                          # confirm release page renders
npm view @os-eco/plot-cli version               # confirm published version
```

Smoke-install in a clean dir:

```bash
mkdir /tmp/plot-smoke && cd /tmp/plot-smoke
bun install @os-eco/plot-cli
bunx plot --version    # should print X.Y.Z
bunx plot --help       # should list all subcommands
```

## 2. Triage of a failed publish

When `.github/workflows/publish.yml` exits non-zero:

### 2.1 Read the log

```bash
gh run list --workflow=publish.yml --limit 5
gh run view <run-id> --log-failed
```

Common failures and fixes:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Version mismatch! package.json=... src/version.ts=...` | The "Verify version sync" step failed. | Run `bun run version:bump` to resync, or hand-edit both files; push a fix commit. |
| `Version X.Y.Z already published, skipping.` | npm already has this version. | Not an error — the workflow short-circuits to a no-op. Bump if you intended to ship something. |
| `npm publish ... 403` | Missing/expired `NPM_TOKEN` secret, or provenance/OIDC misconfigured. | Repo → Settings → Secrets → update `NPM_TOKEN`; confirm trusted publishing on the npm package; re-run. |
| `npm publish ... E409` | Version already published from a different commit. | Bump to the next patch; do **not** unpublish a live version. |
| `gh release create ... already exists` | Tag `vX.Y.Z` exists but a previous run created an incomplete release. | Delete the orphan release in the GitHub UI, then re-run the workflow. |
| `tsc` / `biome` / `bun test` failure in publish.yml | Local greens diverged from CI (env, OS-specific path, race). | Reproduce locally; do **not** force-push to `main`. |
| `check:agents` failure | A backticked path or `bun run X` reference in `AGENTS.md` no longer resolves. | Read the failure detail, fix the reference or extend the known-missing allowlist in `scripts/validate-agents-md.ts`, push. |

### 2.2 Re-run the workflow

After the fix commit lands on `main`:

```bash
gh workflow run publish.yml --ref main
```

Or push a no-op commit if you need the path-filtered push trigger:

```bash
git commit --allow-empty -m "release: retry publish"
git push origin main
```

### 2.3 If the publish half-succeeded

If `npm publish` completed but `gh release create` failed (or vice
versa), **do not unpublish**. Recover the missing half manually:

- npm version exists but the GitHub release is missing:
  ```bash
  awk '/^## \[X.Y.Z\]/{found=1; next} found && /^## \[/{exit} found{print}' CHANGELOG.md > /tmp/notes.md
  gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes.md
  ```
- npm has the version but the git tag is missing:
  ```bash
  git tag vX.Y.Z <release-sha>
  git push origin vX.Y.Z
  ```

Record the deviation in a `pl-XXXX` tracker so future operators know the
half-step happened.

## 3. Rollback

A "rollback" never means unpublishing. npm and git tags are immutable.
Rollback means **publishing a corrective version**.

### 3.1 Decide the severity

- **Critical** (data loss, corrupted Plot files, total CLI breakage):
  cut a new patch release reverting the change in under 30 minutes.
- **High** (regression on a common path: `plot append` drops events,
  `plot get` returns the wrong view, index rebuild corrupts state): cut
  a patch within the day.
- **Medium / Low**: fix forward on the next planned release.

### 3.2 Revert the offending commits

```bash
git checkout main
git pull
git log --oneline -10
git revert <bad-sha>           # creates a new commit, preserves history
```

If the bad release is `X.Y.Z`, the revert commit goes into the work for
`X.Y.(Z+1)`. Resolve any conflicts from intervening commits.

### 3.3 Cut a follow-up release

Follow §1.1–§1.5. In `CHANGELOG.md`, note the rollback explicitly:

```markdown
## [X.Y.(Z+1)] — YYYY-MM-DD

### Fixed
- Reverted <one-line bad-commit summary> from X.Y.Z which caused
  <symptom>. Tracking in pl-XXXX / #NNN.
```

### 3.4 Deprecate the bad version on npm

If `@os-eco/plot-cli@X.Y.Z` is dangerous to install:

```bash
npm deprecate @os-eco/plot-cli@X.Y.Z \
  "Critical bug; install X.Y.(Z+1) or later. See CHANGELOG.md."
```

`npm deprecate` does not remove the version (which would break
reproducible installs); it surfaces a warning at install time.

### 3.5 Communicate

- Edit the GitHub release notes for `vX.Y.Z` with a banner at the top:
  `> ⚠️ This release contains a regression. Use vX.Y.(Z+1) or later.`
- File / update `pl-XXXX` with root cause + remediation links.
- If a downstream consumer (warren, sapling) pinned the bad version,
  open an issue against that repo recommending the upgrade. Plot is a
  substrate dependency — flag schema-affecting reverts loudly.

## Appendix — Common commands

```bash
# Inspect recent releases
git tag --sort=-creatordate | head -5
gh release list --limit 5

# Inspect a failing workflow run
gh run list --workflow=publish.yml --limit 5
gh run view <run-id> --log-failed

# Re-run a single failed job
gh run rerun <run-id> --failed

# Inspect what npm has published
npm view @os-eco/plot-cli versions --json
npm view @os-eco/plot-cli dist-tags
```

## Appendix — Pre-publish checklist (copy-paste into release PR body)

- [ ] `package.json` and `src/version.ts` agree on `X.Y.Z`.
- [ ] `CHANGELOG.md` has a dated `## [X.Y.Z] — YYYY-MM-DD` section.
- [ ] `bun run lint && bun run typecheck && bun test` exit 0.
- [ ] `bun run check:agents` exits 0.
- [ ] `gh run watch` confirmed `publish.yml` succeeded.
- [ ] `npm view @os-eco/plot-cli version` reports `X.Y.Z`.
- [ ] Smoke install in a clean dir succeeds.
- [ ] GitHub release page renders the changelog section correctly.

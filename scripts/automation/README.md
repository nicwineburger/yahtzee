# Repo automation

Deterministic tooling that lets Claude Code (or a human) manage this repo:
conventional commits, standardized PRs/issues, CI introspection, semver
releases, and a template export. Orchestration lives in the Claude Code
skills under `.claude/skills/`; everything mechanical lives here.

```
.automation.conf          repo-specific config (the ONLY per-repo file)
        │ sourced by
scripts/automation/lib.sh shared helpers (exit codes, gh guard, repo slug)
        │ used by
scripts/automation/*.sh   single-purpose scripts (below)
        │ called from
.claude/skills/*          issue-flow · expand-issue · pr-fix · release · tdd
```

## Exit codes (all scripts)

| code | meaning |
|---|---|
| 0 | success |
| 1 | validation / lint failure |
| 2 | usage error |
| 3 | nothing to do (no failed runs, nothing releasable, empty range) |
| 4 | environment problem (gh missing/old/unauthenticated, dirty tree, …) |

Every network-touching script starts with `require_gh`: gh ≥ 2.40.0,
authenticated, jq present — failing with an actionable one-liner
(`Run: gh auth login`) otherwise.

## Scripts

| script | interface |
|---|---|
| `check-setup.sh [--fix]` | doctor; prints `ok:`/`warn:`/`FAIL:`; exit 4 on any FAIL; `--fix` installs hooks |
| `install-hooks.sh [--uninstall]` | per-clone: `core.hooksPath=.githooks`, `commit.template=.gitmessage` |
| `lint-commit.sh [--explain] --message\|--file\|--range` | conventional-commit lint; silent on pass; `--explain` prints `TYPE=/SCOPE=/BREAKING=` |
| `branch.sh <type> <issue#\|-> <slug…>` | topic branch `<type>/<N>-<slug>` off fresh `origin/main`; prints name |
| `issue-fetch.sh <N> [--json]` | issue + all comments as model-ready markdown |
| `pr-create.sh --title T [--body-file F] [--issue N] [--draft]` | lints title, pushes, opens PR; idempotent; **last stdout line = PR#** |
| `ci-status.sh <PR#> [--wait]` | one `name<TAB>status` per check; exit 0 green / 1 failed / 3 pending |
| `ci-logs.sh <PR#> [--full]` | failing-job logs for the PR head, last 200 lines/run unless `--full` |
| `pr-merge.sh <PR#> [--yes] [--dry-run]` | re-lints title, requires green checks, squash-merges as `"<title> (#N)"`, syncs main |
| `next-version.sh [--current\|--bump]` | next semver tag from commits since last tag; no tags → `INITIAL_VERSION` |
| `changelog.sh [--from] [--to] [--version]` | grouped markdown changelog to stdout |
| `release.sh [--dry-run] [--yes] [--version]` | tag + push + GitHub Release with generated notes |
| `export-template.sh <dir> [--force]` | export the generic layer for a template repo; **fails if repo-specific words leak** |

Destructive/remote-mutating scripts (`pr-merge.sh`, `release.sh`) prompt for
confirmation; `AUTOMATION_YES=1` (or `--yes`) skips the prompt — skills set it
only after the user has approved via the merge gate.

## Commit contract

Subject: `<type>(<scope>)!: <summary>` — type from `COMMIT_TYPES`, scope
optional lowercase `[a-z0-9._/-]`, `!` = breaking, summary ≤ `SUBJECT_MAX_LEN`
chars (a squash-appended ` (#123)` is not counted), no trailing period, blank
line before any body. Breaking also via a `BREAKING CHANGE: …` body line.
Enforced by: `.githooks/commit-msg` locally, the `lint-pr-title` job on every
PR (the title becomes the squash commit), and `pr-merge.sh` at merge time.

Version bumps: breaking → major · `feat` → minor · `fix`/`perf`/`revert` →
patch · anything else → not releasable. Changelog sections: Breaking Changes,
Features, Bug Fixes, Performance, Maintenance (non-conventional history lands
in Maintenance tagged `(non-conventional)`).

## Bot comment markers

Every automation-authored GitHub comment starts with a marker on line 1 so
flows can find/update their own comments idempotently:

- `<!-- claude:requirements v1 -->` — on the issue; updated in place on re-runs
- `<!-- claude:review round=K pr=M -->` — on the PR; append-only per round
- `<!-- claude:fixes round=K pr=M -->` — on the PR; 1:1 responses to a review
- `<!-- claude:conclusion issue=N pr=M -->` — on the issue after merge

Fill-in templates: `scripts/automation/templates/*.md` (`{{PLACEHOLDER}}`
tokens are replaced by the orchestrating skill, not by shell).

## Event-driven triggering

Comments do not trigger anything by themselves in a live Claude Code session —
the skills poll (`ci-status.sh --wait`, re-reading PR comments between review
rounds). For push-based automation, `.github/workflows/claude.yml` runs
Claude Code on GitHub runners via `anthropics/claude-code-action` (new issues
auto-expanded; @claude mentions answered). It stays inert until the Claude
GitHub App is installed (`/install-github-app`) and an `ANTHROPIC_API_KEY`
secret exists — note this is API-key billed, separate from a claude.ai
subscription. Subscription-only alternative: a scheduled claude.ai routine
that periodically scans for new issues/mentions and runs the same skills.

## Template export

`export-template.sh <dir>` copies the generic layer (scripts, hooks, skills,
agents, settings, issue/PR templates, claude.yml), regenerates the
repo-specific parts as EDIT-ME examples (`.automation.conf.example`, a
placeholder-test `pr.yml`), writes `TEMPLATE_SETUP.md`, then greps the export
for `TEMPLATE_LEAK_WORDS` + the origin owner/repo and fails on any hit. If
the leak check fires, a repo-specific reference crept into the generic layer —
fix the source file, don't whitelist the word.

## Portability rules for scripts in this directory

`#!/usr/bin/env bash` + `set -euo pipefail`; bash-3.2-compatible (macOS):
no associative arrays, no `mapfile`, no `${var,,}`; never `sed -i`; derive
repo info at runtime (`repo_slug`), never hardcode; colors only on tty;
temp files via `mktemp` with `trap` cleanup.

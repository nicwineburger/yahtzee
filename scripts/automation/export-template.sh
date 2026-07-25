#!/usr/bin/env bash
# Export the generic automation layer into a target directory, ready to seed
# a repo template. Repo-specific values are replaced with EDIT-ME examples,
# then the export is grepped for leak words (TEMPLATE_LEAK_WORDS + the origin
# owner/repo) and the script FAILS if any repo-specific reference slipped in.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

usage() { echo "usage: export-template.sh <target-dir> [--force]" >&2; exit 2; }

TARGET="${1-}"
[ -n "$TARGET" ] || usage
FORCE=0
[ "${2-}" = "--force" ] && FORCE=1

if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
  die 4 "target '$TARGET' is not empty (use --force to overwrite)"
fi
mkdir -p "$TARGET"

# --- generic layer, copied verbatim ---
mkdir -p "$TARGET/scripts" "$TARGET/.github/workflows" "$TARGET/.claude"
cp -R "$SCRIPT_DIR" "$TARGET/scripts/automation"
rm -f "$TARGET/scripts/automation/"*.tmp 2>/dev/null || true
cp -R "$ROOT/.githooks" "$TARGET/.githooks"
cp "$ROOT/.gitmessage" "$TARGET/.gitmessage"
if [ -d "$ROOT/.claude/skills" ]; then cp -R "$ROOT/.claude/skills" "$TARGET/.claude/skills"; fi
if [ -d "$ROOT/.claude/agents" ]; then cp -R "$ROOT/.claude/agents" "$TARGET/.claude/agents"; fi
if [ -f "$ROOT/.claude/settings.json" ]; then cp "$ROOT/.claude/settings.json" "$TARGET/.claude/settings.json"; fi
if [ -f "$ROOT/.github/PULL_REQUEST_TEMPLATE.md" ]; then cp "$ROOT/.github/PULL_REQUEST_TEMPLATE.md" "$TARGET/.github/"; fi
if [ -d "$ROOT/.github/ISSUE_TEMPLATE" ]; then cp -R "$ROOT/.github/ISSUE_TEMPLATE" "$TARGET/.github/ISSUE_TEMPLATE"; fi
if [ -f "$ROOT/.github/workflows/claude.yml" ]; then cp "$ROOT/.github/workflows/claude.yml" "$TARGET/.github/workflows/claude.yml"; fi
# The CI-image build is part of the generic layer: the rule "jobs pull an
# image that already has the tooling" only survives into a new repo if the
# thing that builds that image comes with it. The Dockerfile is repo-specific
# in content but generic in shape, so it exports as an EDIT-ME starting point.
if [ -f "$ROOT/.github/workflows/ci-image.yml" ]; then cp "$ROOT/.github/workflows/ci-image.yml" "$TARGET/.github/workflows/ci-image.yml"; fi
if [ -f "$ROOT/.github/docker/ci.Dockerfile" ]; then
  mkdir -p "$TARGET/.github/docker"
  cp "$ROOT/.github/docker/ci.Dockerfile" "$TARGET/.github/docker/ci.Dockerfile"
fi

# --- repo-specific parts, regenerated as EDIT-ME examples ---
cat >"$TARGET/.automation.conf.example" <<'EOF'
# Copy to .automation.conf and edit. Plain KEY=VALUE assignments only.

DEFAULT_BRANCH=main
MERGE_STRATEGY=squash

RELEASE_TAG_PREFIX=v
INITIAL_VERSION=0.1.0

# EDIT ME: your full test suite, run from the repo root.
TEST_CMD="echo 'set TEST_CMD in .automation.conf' && exit 1"
# EDIT ME: optional secondary suite ("" = none).
MATH_TEST_CMD=""

# EDIT ME: the image CI jobs run inside, pinned by DIGEST (tags are mutable).
# Build it from .github/docker/ci.Dockerfile via .github/workflows/ci-image.yml,
# then paste the digest that run prints here. Every tool your jobs need must be
# IN this image — CI must not install tooling at run time. Required before the
# implement job in claude.yml can run.
CI_IMAGE=""

# EDIT ME: the same suites as claude.yml's implement job runs before it pushes.
# CI_TEST_SETUP is for project dependencies only (a lockfile install like
# `npm ci`); anything else belongs in the Dockerfile, not here. CI_TEST_SETUP
# failing is not fatal — it only means Claude can't self-verify that run.
CI_TEST_SETUP="echo 'no CI test setup configured'"
CI_TEST_CMD="$TEST_CMD"
CI_MATH_TEST_CMD=""

COMMIT_TYPES="feat fix docs style refactor perf test build ci chore revert"
COMMIT_SCOPES=""
SUBJECT_MAX_LEN=72

BRANCH_TYPES="feat fix chore docs refactor test ci perf"

REVIEW_MAX_ROUNDS=3

# EDIT ME: words that must never appear in a template export of this repo.
TEMPLATE_LEAK_WORDS=""

# EDIT ME: maps each issue-template "### Area" dropdown option
# (.github/ISSUE_TEMPLATE/*.yml) to a label, e.g.
# "frontend=area:frontend;backend=area:backend". "" = no area labels.
# Used by setup-labels.sh and by claude.yml / the expand-issue skill.
AREA_LABEL_MAP=""
EOF

cat >"$TARGET/.github/workflows/pr.yml" <<'EOF'
name: PR checks

on:
  pull_request:
    branches: [main]
    types: [opened, edited, synchronize, reopened]
  # Fallback for PRs opened by claude.yml's `implement` job (GITHUB_TOKEN
  # PRs don't fire pull_request normally — see that job's comments). Keep
  # this trigger even if you don't use the implement job.
  workflow_dispatch:
    inputs:
      pr_number:
        description: "PR number to lint (set by claude.yml's implement job)"
        required: true

concurrency:
  group: pr-${{ github.event.pull_request.number || github.event.inputs.pr_number }}
  cancel-in-progress: true

jobs:
  lint-pr-title:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Resolve PR title (workflow_dispatch has no pull_request context)
        id: pr
        env:
          GH_TOKEN: ${{ github.token }}
          EVENT_NAME: ${{ github.event_name }}
          PR_NUMBER: ${{ github.event.inputs.pr_number }}
          EVENT_TITLE: ${{ github.event.pull_request.title }}
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
            TITLE="$(gh pr view "$PR_NUMBER" --json title -q .title)"
          else
            TITLE="$EVENT_TITLE"
          fi
          printf 'title=%s\n' "$TITLE" >>"$GITHUB_OUTPUT"
      - name: PR title must be a conventional commit (it becomes the squash commit)
        env:
          PR_TITLE: ${{ steps.pr.outputs.title }}
        run: ./scripts/automation/lint-commit.sh --message "$PR_TITLE"

  test:
    runs-on: ubuntu-latest
    # EDIT ME: run this job in the image you built from
    # .github/docker/ci.Dockerfile, pinned to the digest ci-image.yml printed
    # (the same value as CI_IMAGE in .automation.conf). Do NOT replace this
    # with toolchain install steps — tools belong in the image, so that what a
    # job runs is decided by a commit here rather than by whatever the network
    # serves that minute. See TEMPLATE_SETUP.md step 6.
    # container:
    #   image: ghcr.io/OWNER/REPO-ci@sha256:...
    #   credentials:
    #     username: ${{ github.actor }}
    #     password: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      # EDIT ME: your suite, matching TEST_CMD. Installing project
      # dependencies from a lockfile here is fine (npm ci, poetry install
      # --sync, …); installing TOOLS is not.
      - name: Tests
        run: |
          echo "Replace this step with your test suite (see TEST_CMD in .automation.conf)"
          exit 1
EOF

cat >"$TARGET/TEMPLATE_SETUP.md" <<'EOF'
# Automation template — setup for a new repo

1. Copy `.automation.conf.example` to `.automation.conf`; set `TEST_CMD`
   (and optionally scopes, leak words, secondary suite, `AREA_LABEL_MAP`).
2. Edit `.github/workflows/pr.yml`: replace the placeholder `test` job with
   your real suite (keep the `lint-pr-title` job and its `workflow_dispatch`
   trigger as is).
3. Run `scripts/automation/install-hooks.sh` once per clone (commit-msg lint
   + commit template).
4. Run `scripts/automation/check-setup.sh` — fix anything it flags
   (needs gh >= 2.40 authenticated, jq).
5. Run `scripts/automation/setup-labels.sh` to create the status/`implement`/
   `blocked`/area labels (see `scripts/automation/README.md`'s Label
   lifecycle section). Safe to re-run any time, including after editing
   `AREA_LABEL_MAP`.
6. Build the CI image and pin it. **CI jobs must never install tooling at run
   time** — every tool a job needs belongs in the image it pulls, pinned to a
   version you chose:
   - edit `.github/docker/ci.Dockerfile` so it contains your toolchain (it
     ships as a Playwright + gh + Python example; change the base and the
     installs to match your stack, and keep the build-time assertions so a
     missing tool fails the build instead of a run — `git` in particular, or
     `actions/checkout` silently degrades to a tarball with no `.git`),
   - push that change: `.github/workflows/ci-image.yml` builds it and prints
     the digest,
   - set `CI_IMAGE` in `.automation.conf` to that digest, and use the same
     digest in the `container: image:` of your test jobs.
   This is inherently two steps — a commit changing the Dockerfile cannot
   reference the digest it produces — and it repeats on every image update.
7. Optional event-driven layer: run `/install-github-app` from Claude Code,
   add an `ANTHROPIC_API_KEY` repo secret; `.github/workflows/claude.yml`
   then answers @claude mentions, expands new issues automatically, and (if
   you add the `implement` label to a requirements-bearing issue) implements
   the change on a branch and opens a PR. Its implement job runs inside
   `CI_IMAGE`, so step 6 has to be done first.
8. In GitHub repo settings, allow ONLY squash merging (the automation
   assumes squash; PR titles become the commits on the default branch).
9. Settings -> Actions -> General -> Workflow permissions: check "Allow
   GitHub Actions to create and approve pull requests" — the implement job
   opens PRs with the workflow token and fails without it. API equivalent:
   `gh api -X PUT repos/OWNER/REPO/actions/permissions/workflow -f
   default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
10. Optional `WORKFLOWS_PAT` repo secret (fine-grained PAT with contents +
   workflows write): lets the implement job push changes that touch
   `.github/workflows/**` — the Actions token cannot (GitHub platform
   restriction). Without it, such issues fail fast with guidance to use the
   local /issue-flow instead.

Day-to-day: see `scripts/automation/README.md` and the Claude Code skills in
`.claude/skills/` (issue-flow, expand-issue, pr-fix, release, tdd).
EOF

# --- leak check ---
SLUG="$(repo_slug)"
OWNER="${SLUG%%/*}"
NAME="${SLUG##*/}"
WORDS="$(printf '%s' "$TEMPLATE_LEAK_WORDS $OWNER $NAME" \
         | tr ' ' '\n' | grep -v '^$' | sort -u | paste -sd'|' -)"
if [ -n "$WORDS" ]; then
  HITS="$(grep -riIlE "($WORDS)" "$TARGET" 2>/dev/null || true)"
  if [ -n "$HITS" ]; then
    printf '%s\n' "$HITS" >&2
    die 1 "leak check FAILED: repo-specific words ($WORDS) found in the files above — keep the generic layer generic"
  fi
fi

log "template exported to $TARGET (leak check passed)"

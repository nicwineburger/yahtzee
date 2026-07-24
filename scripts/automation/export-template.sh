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

COMMIT_TYPES="feat fix docs style refactor perf test build ci chore revert"
COMMIT_SCOPES=""
SUBJECT_MAX_LEN=72

BRANCH_TYPES="feat fix chore docs refactor test ci perf"

REVIEW_MAX_ROUNDS=3

# EDIT ME: words that must never appear in a template export of this repo.
TEMPLATE_LEAK_WORDS=""
EOF

cat >"$TARGET/.github/workflows/pr.yml" <<'EOF'
name: PR checks

on:
  pull_request:
    branches: [main]
    types: [opened, edited, synchronize, reopened]

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  lint-pr-title:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: PR title must be a conventional commit (it becomes the squash commit)
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: ./scripts/automation/lint-commit.sh --message "$PR_TITLE"

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # EDIT ME: install your toolchain, then run the same suite as TEST_CMD.
      - name: Tests
        run: |
          echo "Replace this step with your test suite (see TEST_CMD in .automation.conf)"
          exit 1
EOF

cat >"$TARGET/TEMPLATE_SETUP.md" <<'EOF'
# Automation template — setup for a new repo

1. Copy `.automation.conf.example` to `.automation.conf`; set `TEST_CMD`
   (and optionally scopes, leak words, secondary suite).
2. Edit `.github/workflows/pr.yml`: replace the placeholder `test` job with
   your real suite (keep the `lint-pr-title` job as is).
3. Run `scripts/automation/install-hooks.sh` once per clone (commit-msg lint
   + commit template).
4. Run `scripts/automation/check-setup.sh` — fix anything it flags
   (needs gh >= 2.40 authenticated, jq).
5. Optional event-driven layer: run `/install-github-app` from Claude Code,
   add an `ANTHROPIC_API_KEY` repo secret; `.github/workflows/claude.yml`
   then answers @claude mentions and expands new issues automatically.
6. In GitHub repo settings, allow ONLY squash merging (the automation
   assumes squash; PR titles become the commits on the default branch).

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

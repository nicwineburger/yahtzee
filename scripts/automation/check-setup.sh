#!/usr/bin/env bash
# Doctor: verifies the automation environment. Prints ok:/warn:/FAIL: lines.
# Exit 0 if healthy (warns allowed), 4 if any FAIL. --fix repairs warn-level
# items (hooks + commit template).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

FIX=0
[ "${1-}" = "--fix" ] && FIX=1

STATUS=0
ok()   { printf 'ok:   %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; STATUS=4; }
note() { printf 'warn: %s\n' "$*"; }

# --- git / remote ---
if SLUG="$(repo_slug 2>/dev/null)"; then
  ok "git repo with origin remote ($SLUG)"
else
  fail "cannot derive owner/repo from 'origin' remote"
fi

if git -C "$ROOT" show-ref --verify --quiet "refs/remotes/origin/$DEFAULT_BRANCH"; then
  ok "origin/$DEFAULT_BRANCH known locally"
else
  note "origin/$DEFAULT_BRANCH not fetched yet (run: git fetch origin)"
fi

# --- config sanity ---
if [ "$MERGE_STRATEGY" = "squash" ]; then
  ok ".automation.conf: MERGE_STRATEGY=squash"
else
  fail ".automation.conf: MERGE_STRATEGY must be 'squash' (got '$MERGE_STRATEGY')"
fi

# --- tools ---
if command -v jq >/dev/null 2>&1; then
  ok "jq $(jq --version 2>/dev/null | sed 's/^jq-//')"
else
  fail "jq not installed. Run: brew install jq"
fi

if ! command -v gh >/dev/null 2>&1; then
  fail "gh (GitHub CLI) not installed. Run: brew install gh"
elif ! gh_version_ok; then
  fail "gh $(gh --version | awk 'NR==1{print $3}') too old (need >= $GH_MIN_VERSION). Run: brew upgrade gh"
elif ! gh auth status >/dev/null 2>&1; then
  fail "gh not authenticated (token expired?). Run: gh auth login"
else
  ok "gh $(gh --version | awk 'NR==1{print $3}') authenticated"
fi

# --- hooks / template ---
HOOKS_PATH="$(git -C "$ROOT" config core.hooksPath 2>/dev/null || true)"
if [ "$HOOKS_PATH" = ".githooks" ]; then
  ok "commit-msg hook installed (core.hooksPath=.githooks)"
elif [ "$FIX" = 1 ]; then
  "$SCRIPT_DIR/install-hooks.sh"
  ok "hooks installed via --fix"
else
  note "commit-msg hook not installed. Run: scripts/automation/install-hooks.sh (or --fix)"
fi

TEMPLATE="$(git -C "$ROOT" config commit.template 2>/dev/null || true)"
if [ "$TEMPLATE" = ".gitmessage" ]; then
  ok "commit.template = .gitmessage"
elif [ "$FIX" != 1 ]; then
  note "commit.template not set. Run: scripts/automation/install-hooks.sh (or --fix)"
fi

# --- scripts executable ---
NOEXEC=""
for f in "$SCRIPT_DIR"/*.sh "$ROOT/.githooks/"*; do
  [ -x "$f" ] || NOEXEC="$NOEXEC $(basename "$f")"
done
if [ -z "$NOEXEC" ]; then
  ok "automation scripts executable"
else
  note "not executable:$NOEXEC (fix: chmod +x scripts/automation/*.sh .githooks/*)"
fi

exit "$STATUS"

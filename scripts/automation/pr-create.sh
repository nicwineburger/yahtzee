#!/usr/bin/env bash
# Push the current branch and open a PR. The title is lint-enforced because
# with squash merge it becomes the commit on DEFAULT_BRANCH.
# Idempotent: if the branch already has an open PR, prints its number.
# Machine contract: the LAST stdout line is the PR number (bare integer).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: pr-create.sh --title "<conventional subject>" [--body-file <file>]
                    [--issue <N>] [--draft]
  --issue N ensures a "Closes #N" line is present in the body.
EOF
  exit 2
}

TITLE="" BODY_FILE="" ISSUE="" DRAFT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --title)     TITLE="${2-}"; shift ;;
    --body-file) BODY_FILE="${2-}"; shift ;;
    --issue)     ISSUE="${2-}"; shift ;;
    --draft)     DRAFT=1 ;;
    *) usage ;;
  esac
  shift
done
[ -n "$TITLE" ] || usage

require_gh
CUR="$(git -C "$ROOT" branch --show-current)"
[ "$CUR" != "$DEFAULT_BRANCH" ] || die 4 "refusing to open a PR from $DEFAULT_BRANCH — create a topic branch first (branch.sh)"

"$SCRIPT_DIR/lint-commit.sh" --message "$TITLE" \
  || die 1 "PR title must be a valid conventional commit (it becomes the squash commit on $DEFAULT_BRANCH)"

if EXISTING="$(gh pr view --json number,url -q '"\(.number) \(.url)"' 2>/dev/null)"; then
  log "PR already exists for $CUR: ${EXISTING#* }"
  printf '%s\n' "${EXISTING%% *}"
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [ -n "$BODY_FILE" ]; then
  [ -f "$BODY_FILE" ] || die 2 "no such file: $BODY_FILE"
  cat "$BODY_FILE" >"$TMP"
else
  cat "$SCRIPT_DIR/templates/pr-body.md" >"$TMP"
fi
if [ -n "$ISSUE" ] && ! grep -q "Closes #$ISSUE" "$TMP"; then
  printf '\nCloses #%s\n' "$ISSUE" >>"$TMP"
fi

git -C "$ROOT" push -u origin HEAD >&2

ARGS=(--base "$DEFAULT_BRANCH" --title "$TITLE" --body-file "$TMP")
[ "$DRAFT" = 1 ] && ARGS=("${ARGS[@]}" --draft)
gh pr create "${ARGS[@]}" >&2

NUM="$(gh pr view --json number -q .number)"
printf '%s\n' "$NUM"

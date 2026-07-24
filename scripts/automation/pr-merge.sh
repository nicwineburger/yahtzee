#!/usr/bin/env bash
# Squash-merge a green, reviewed PR. The squash subject is the (re-linted)
# PR title plus "(#N)", so DEFAULT_BRANCH history stays conventional.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

usage() { echo "usage: pr-merge.sh <PR#> [--yes] [--dry-run]" >&2; exit 2; }

N="${1-}"
case "$N" in ''|*[!0-9]*) usage ;; esac
DRY=0
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) AUTOMATION_YES=1 ;;
    --dry-run) DRY=1 ;;
    *) usage ;;
  esac
  shift
done

require_gh

INFO="$(gh pr view "$N" --json title,baseRefName,state,isDraft,headRefName,url)" \
  || die 4 "could not fetch PR #$N"
TITLE="$(printf '%s' "$INFO" | jq -r .title)"
BASE="$(printf '%s' "$INFO" | jq -r .baseRefName)"
STATE="$(printf '%s' "$INFO" | jq -r .state)"
DRAFT="$(printf '%s' "$INFO" | jq -r .isDraft)"
HEAD_BRANCH="$(printf '%s' "$INFO" | jq -r .headRefName)"
URL="$(printf '%s' "$INFO" | jq -r .url)"

[ "$STATE" = "OPEN" ] || die 4 "PR #$N is $STATE, not open"
[ "$DRAFT" = "false" ] || die 4 "PR #$N is still a draft — run: gh pr ready $N"
[ "$BASE" = "$DEFAULT_BRANCH" ] || die 1 "PR #$N targets '$BASE', expected '$DEFAULT_BRANCH'"

"$SCRIPT_DIR/lint-commit.sh" --message "$TITLE" \
  || die 1 "PR title is not a valid conventional commit — fix it with: gh pr edit $N --title \"...\""

"$SCRIPT_DIR/ci-status.sh" "$N" >/dev/null \
  || die 1 "checks are not green on PR #$N (see: ci-status.sh $N)"

SUBJECT="$TITLE (#$N)"
if [ "$DRY" = 1 ]; then
  log "dry-run: would squash-merge PR #$N ($URL) as: $SUBJECT"
  exit 0
fi

confirm "Squash-merge PR #$N as \"$SUBJECT\"?"
gh pr merge "$N" --squash --delete-branch --subject "$SUBJECT"

git -C "$ROOT" switch "$DEFAULT_BRANCH" >/dev/null 2>&1 || true
git -C "$ROOT" pull --ff-only
git -C "$ROOT" remote prune origin >/dev/null
git -C "$ROOT" branch -D "$HEAD_BRANCH" >/dev/null 2>&1 || true
log "merged PR #$N into $DEFAULT_BRANCH"

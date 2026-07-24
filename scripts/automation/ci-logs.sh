#!/usr/bin/env bash
# Print failing-job logs for a PR's head commit. Tail-limited to keep agent
# context small; --full disables the limit.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() { echo "usage: ci-logs.sh <PR#> [--full]" >&2; exit 2; }

N="${1-}"
case "$N" in ''|*[!0-9]*) usage ;; esac
FULL=0
[ "${2-}" = "--full" ] && FULL=1
TAIL_LINES=200

require_gh

SHA="$(gh pr view "$N" --json headRefOid -q .headRefOid)" \
  || die 4 "could not fetch PR #$N"

RUNS="$(gh run list --commit "$SHA" --json databaseId,name,conclusion \
        -q '.[] | select(.conclusion == "failure") | "\(.databaseId)\t\(.name)"')"
[ -n "$RUNS" ] || die 3 "no failed workflow runs for PR #$N (head ${SHA:0:12})"

printf '%s\n' "$RUNS" | while IFS="$(printf '\t')" read -r ID NAME; do
  printf '=== failed run: %s (id %s) ===\n' "$NAME" "$ID"
  if [ "$FULL" = 1 ]; then
    gh run view "$ID" --log-failed || true
  else
    gh run view "$ID" --log-failed 2>/dev/null | tail -n "$TAIL_LINES" || true
    printf '--- (last %s lines; use --full for everything) ---\n' "$TAIL_LINES"
  fi
done

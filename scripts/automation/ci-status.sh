#!/usr/bin/env bash
# Report CI check status for a PR, one "name<TAB>status" line per check.
# Exit: 0 all green (skips allowed) · 1 any failure · 3 still pending.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() { echo "usage: ci-status.sh <PR#> [--wait]" >&2; exit 2; }

N="${1-}"
case "$N" in ''|*[!0-9]*) usage ;; esac
WAIT=0
[ "${2-}" = "--wait" ] && WAIT=1

require_gh

if [ "$WAIT" = 1 ]; then
  # blocks until all checks finish; prints its own live table to stderr
  gh pr checks "$N" --watch --interval 15 >&2 || true
fi

set +e
OUT="$(gh pr checks "$N" 2>&1)"
set -e

if [ -z "$OUT" ]; then
  die 3 "no checks reported for PR #$N (yet?)"
fi
printf '%s\n' "$OUT"

STATUSES="$(printf '%s\n' "$OUT" | awk -F'\t' 'NF >= 2 {print $2}')"
if printf '%s\n' "$STATUSES" | grep -q '^fail'; then
  exit 1
elif printf '%s\n' "$STATUSES" | grep -q '^pending'; then
  exit 3
fi
exit 0

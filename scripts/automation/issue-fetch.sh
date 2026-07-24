#!/usr/bin/env bash
# Fetch a GitHub issue with all comments as one model-ready markdown document
# (or raw JSON with --json). Marker lines (<!-- claude:... -->) are preserved.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() { echo "usage: issue-fetch.sh <issue#> [--json]" >&2; exit 2; }

N="${1-}"
case "$N" in ''|*[!0-9]*) usage ;; esac
MODE=md
[ "${2-}" = "--json" ] && MODE=json

require_gh

JSON="$(gh issue view "$N" --json number,title,state,author,labels,body,comments,url)" \
  || die 4 "could not fetch issue #$N"

if [ "$MODE" = json ]; then
  printf '%s\n' "$JSON"
  exit 0
fi

printf '%s\n' "$JSON" | jq -r '
  "# issue #\(.number): \(.title)",
  "state: \(.state) · author: @\(.author.login) · labels: \([.labels[].name] | join(", ")) · \(.url)",
  "",
  (.body // "(no body)"),
  ( .comments[]? |
    "",
    "---",
    "### comment by @\(.author.login) (\(.createdAt))",
    "",
    .body )
'

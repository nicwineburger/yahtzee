#!/usr/bin/env bash
# Idempotently create/update the labels the automation lifecycle depends on
# (status:*, blocked, implement, plus the area labels from AREA_LABEL_MAP in
# .automation.conf). Safe to re-run any time. NOT run automatically by any
# workflow or skill — a human (or the orchestrator, once) runs this after
# reviewing AREA_LABEL_MAP for the repo.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

require_gh

create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --color "$color" --description "$desc" --force >/dev/null
  log "label: $name"
}

create_label "status:requirements" "1d76db" "Requirements posted; ready for implementation"
create_label "status:in-progress"  "fbca04" "Implementation underway on a branch/PR"
create_label "blocked"             "b60205" "Blocked on a decision or external dependency"
create_label "implement"           "0e8a16" "add to a requirements-bearing issue to trigger CI implementation"

# Area labels, derived from AREA_LABEL_MAP so repo-specific dropdown text
# stays out of this generic script (.automation.conf is the only per-repo
# file the generic automation layer expects you to edit).
OLD_IFS="$IFS"
IFS=';'
for pair in $AREA_LABEL_MAP; do
  IFS="$OLD_IFS"
  [ -n "$pair" ] || continue
  text="${pair%%=*}"
  label="${pair#*=}"
  [ -n "$label" ] && [ "$label" != "$pair" ] || {
    warn "skipping malformed AREA_LABEL_MAP entry: $pair"
    continue
  }
  create_label "$label" "5319e7" "Area: $text"
  IFS=';'
done
IFS="$OLD_IFS"

log "labels up to date"

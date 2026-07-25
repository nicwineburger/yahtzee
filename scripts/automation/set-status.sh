#!/usr/bin/env bash
# Move an issue to exactly one status:* label (or none), removing whichever
# other status:* labels it carries. The lifecycle has one status at a time —
# `gh issue edit --add-label` alone can't express that, so every place that
# advances an issue goes through here instead.
#
# Self-healing: if the target label doesn't exist in the repo yet, runs
# setup-labels.sh once and retries, so a fresh clone/template repo doesn't
# need a manual setup step before the automation can label anything.
# Spec: scripts/automation/README.md
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: set-status.sh <issue#> <status:LABEL|none>

Applies exactly one status:* label to the issue, removing the others.
'none' clears them all (terminal state — issue closed/merged).
Exit: 0 ok (including no-op), 1 label operation failed, 2 usage.
EOF
  exit 2
}

ISSUE="${1-}" WANT="${2-}"
[ -n "$ISSUE" ] && [ -n "$WANT" ] || usage
printf '%s' "$ISSUE" | grep -Eq '^[0-9]+$' || usage
case "$WANT" in
  status:*|none) ;;
  *) usage ;;
esac

require_gh

CURRENT="$(gh issue view "$ISSUE" --json labels -q '.labels[].name' 2>/dev/null || true)"

# status:* labels never contain whitespace (they're created by
# setup-labels.sh), so word-splitting the list is safe here.
REMOVE_ARGS=""
HAS_WANT=0
for label in $CURRENT; do
  case "$label" in
    status:*)
      if [ "$label" = "$WANT" ]; then
        HAS_WANT=1
      else
        REMOVE_ARGS="$REMOVE_ARGS --remove-label $label"
      fi
      ;;
  esac
done

ADD_ARGS=""
if [ "$WANT" != "none" ] && [ "$HAS_WANT" = 0 ]; then
  ADD_ARGS="--add-label $WANT"
fi

if [ -z "$REMOVE_ARGS" ] && [ -z "$ADD_ARGS" ]; then
  log "issue #$ISSUE already at status '$WANT' — nothing to do"
  exit 0
fi

# shellcheck disable=SC2086  # deliberate word-splitting of the built flags
if gh issue edit "$ISSUE" $REMOVE_ARGS $ADD_ARGS >/dev/null 2>/tmp/set-status-err.txt; then
  log "issue #$ISSUE -> $WANT"
  exit 0
fi

# Most likely cause: the label doesn't exist in this repo yet. Create the
# lifecycle labels and retry once before giving up.
warn "label edit failed ($(cat /tmp/set-status-err.txt 2>/dev/null)) — creating lifecycle labels and retrying"
"$SCRIPT_DIR/setup-labels.sh" >/dev/null 2>&1 || true

# shellcheck disable=SC2086
gh issue edit "$ISSUE" $REMOVE_ARGS $ADD_ARGS >/dev/null \
  || die 1 "could not set status '$WANT' on issue #$ISSUE"
log "issue #$ISSUE -> $WANT"

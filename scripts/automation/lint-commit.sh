#!/usr/bin/env bash
# Conventional-commit linter — the single contract used by the commit-msg
# hook, the PR-title CI check, and the release preflight.
# Spec: scripts/automation/README.md
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: lint-commit.sh [--explain] --message "<subject line>"
       lint-commit.sh [--explain] --file <commit-msg-file>
       lint-commit.sh --range <rev-range>        # e.g. v0.1.0..HEAD

Silent on success. --explain additionally prints TYPE=/SCOPE=/BREAKING= lines.
Exit: 0 ok, 1 lint failure, 2 usage, 3 empty range.
EOF
  exit 2
}

TYPES_RE="$(commit_type_regex)"
HEADER_RE="^(${TYPES_RE})(\([a-z0-9][a-z0-9._/-]*\))?!?: [^[:space:]]"

FAILED=0
complain() { printf 'lint: %s\n' "$*" >&2; FAILED=1; }

# Reads a full commit message on stdin; $1 is a label for error messages.
lint_message() {
  local label="$1" msg subject line2 stripped scope
  msg="$(grep -v '^#' || true)"   # git strips comment lines; so do we
  subject="$(printf '%s\n' "$msg" | head -n1)"
  line2="$(printf '%s\n' "$msg" | sed -n 2p)"

  if [ -z "$subject" ]; then
    complain "$label: empty commit message"
    return 0
  fi

  printf '%s' "$subject" | grep -Eq "$HEADER_RE" \
    || complain "$label: subject must match '<type>(<scope>)!: <summary>' with type in [$COMMIT_TYPES]; got: $subject"

  # length check ignores a squash-appended trailing " (#123)"
  stripped="$(printf '%s' "$subject" | sed -E 's/ \(#[0-9]+\)$//')"
  [ "${#stripped}" -le "$SUBJECT_MAX_LEN" ] \
    || complain "$label: subject is ${#stripped} chars (max $SUBJECT_MAX_LEN): $subject"

  case "$subject" in
    *.) complain "$label: subject must not end with a period" ;;
  esac

  [ -z "$line2" ] || complain "$label: line 2 must be blank (blank line between subject and body)"

  scope="$(printf '%s' "$subject" | sed -En 's/^[a-z]+\(([^)]*)\).*/\1/p')"
  if [ -n "$COMMIT_SCOPES" ] && [ -n "$scope" ]; then
    printf ' %s ' "$COMMIT_SCOPES" | grep -q " $scope " \
      || complain "$label: scope '$scope' not in allowed scopes [$COMMIT_SCOPES]"
  fi

  if [ "$EXPLAIN" = 1 ] && [ "$FAILED" = 0 ]; then
    local type breaking=0
    type="$(printf '%s' "$subject" | sed -E "s/^(${TYPES_RE}).*/\1/")"
    printf '%s' "$subject" | grep -Eq "^(${TYPES_RE})(\([^)]*\))?!:" && breaking=1
    printf '%s\n' "$msg" | grep -Eq '^BREAKING[ -]CHANGE: ' && breaking=1
    printf 'TYPE=%s\nSCOPE=%s\nBREAKING=%s\n' "$type" "${scope:-}" "$breaking"
  fi
  return 0
}

MODE="" ARG="" EXPLAIN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --explain) EXPLAIN=1 ;;
    --message) MODE=message; ARG="${2-}"; shift ;;
    --file)    MODE=file;    ARG="${2-}"; shift ;;
    --range)   MODE=range;   ARG="${2-}"; shift ;;
    -h|--help|*) usage ;;
  esac
  shift
done
[ -n "$MODE" ] && [ -n "$ARG" ] || usage

case "$MODE" in
  message)
    lint_message "message" <<<"$ARG"
    ;;
  file)
    [ -f "$ARG" ] || die 2 "no such file: $ARG"
    lint_message "$(basename "$ARG")" <"$ARG"
    ;;
  range)
    COUNT=0
    for sha in $(git -C "$ROOT" rev-list "$ARG"); do
      subj="$(git -C "$ROOT" log -1 --format=%s "$sha")"
      case "$subj" in
        Merge\ *|fixup!*|squash!*|Revert\ \"*) continue ;;
      esac
      COUNT=$((COUNT + 1))
      lint_message "${sha:0:8}" <<<"$(git -C "$ROOT" log -1 --format=%B "$sha")"
    done
    [ "$COUNT" -gt 0 ] || exit 3
    ;;
esac

exit "$FAILED"

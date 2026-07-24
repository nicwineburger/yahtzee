#!/usr/bin/env bash
# Repair a PROPOSED conventional-commit subject so it passes lint-commit.sh.
# Mechanical fixes only — never invents meaning: whitespace collapsing,
# trailing-period/punctuation removal, and word-boundary truncation of an
# over-long summary. Anything structural (bad type, missing colon,
# disallowed scope) is left alone and reported as unrepairable, because
# guessing a type would change what the commit claims to be.
#
# Exists so a model-authored title that overshoots SUBJECT_MAX_LEN by a few
# characters does not throw away an otherwise finished implementation (see
# claude.yml's implement job).
# Spec: scripts/automation/README.md
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: normalize-subject.sh --message "<subject line>"

Prints a lint-clean subject on stdout; describes each repair on stderr.
Exit: 0 ok (possibly repaired), 1 unrepairable, 2 usage.
EOF
  exit 2
}

MSG="" HAVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --message) MSG="${2-}"; HAVE=1; shift ;;
    -h|--help|*) usage ;;
  esac
  shift
done
[ "$HAVE" = 1 ] || usage

LINT="$ROOT/scripts/automation/lint-commit.sh"
TYPES_RE="$(commit_type_regex)"
PREFIX_RE="^((${TYPES_RE})(\([a-z0-9][a-z0-9._/-]*\))?!?: )"

note() { printf 'normalize: %s\n' "$*" >&2; }

# Same length rule as lint-commit.sh: a squash-appended " (#123)" is free.
eff_len() { local s; s="$(printf '%s' "$1" | sed -E 's/ \(#[0-9]+\)$//')"; printf '%s' "${#s}"; }

# Trailing punctuation is always junk on a subject (lint rejects a period
# outright), so this one is safe to apply to any title.
trim_punct() { printf '%s' "$1" | sed -E 's/[[:space:],;:.!?/-]+$//'; }

# Dangling function words only become junk once truncation has cut a phrase
# short, so this runs INSIDE the truncation loop only — a title that already
# fits may legitimately end in "for", "to", "a", … and must be left alone.
# Repeats until stable, so "… entirely and for" reduces to "… entirely".
trim_tail() {
  local cur prev=""
  cur="$(trim_punct "$1")"
  while [ "$cur" != "$prev" ]; do
    prev="$cur"
    cur="$(printf '%s' "$cur" | sed -E '
      s/ (and|or|but|with|without|from|to|for|in|on|at|of|by|the|a|an|via|into|when|that)$//
      s/[[:space:],;:.!?/-]+$//')"
  done
  printf '%s' "$cur"
}

SUBJECT="$(printf '%s' "$MSG" | tr '\n\r\t' '   ' | sed -E 's/  +/ /g; s/^ +//; s/ +$//')"
[ -n "$SUBJECT" ] || { printf 'normalize: empty subject\n' >&2; exit 1; }
[ "$SUBJECT" = "$MSG" ] || note "collapsed whitespace"

# Structure must already be right — repairs below only touch the summary.
printf '%s' "$SUBJECT" | grep -Eq "${PREFIX_RE}[^[:space:]]" || {
  printf 'normalize: not a conventional-commit subject, cannot repair: %s\n' "$SUBJECT" >&2
  exit 1
}

PREFIX="$(printf '%s' "$SUBJECT" | sed -E "s/${PREFIX_RE}.*/\1/")"
BODY="${SUBJECT#"$PREFIX"}"

CLEANED="$(trim_punct "$BODY")"
if [ "$CLEANED" != "$BODY" ] && [ -n "$CLEANED" ]; then
  note "stripped trailing punctuation: '$BODY' -> '$CLEANED'"
  BODY="$CLEANED"
fi

ORIGINAL="$SUBJECT"
SUBJECT="$PREFIX$BODY"

# Drop whole trailing words until the subject fits. Truncating mid-word (or
# hard-cutting at the limit) would produce a misleading commit subject.
while [ "$(eff_len "$SUBJECT")" -gt "$SUBJECT_MAX_LEN" ]; do
  case "$BODY" in
    *\ *) BODY="$(trim_tail "${BODY% *}")" ;;
    *)    break ;;   # single overlong word — nothing safe left to drop
  esac
  [ -n "$BODY" ] || break
  SUBJECT="$PREFIX$BODY"
done

if [ "$SUBJECT" != "$ORIGINAL" ] && [ "$(eff_len "$ORIGINAL")" -gt "$SUBJECT_MAX_LEN" ]; then
  note "truncated to $SUBJECT_MAX_LEN chars at a word boundary: '$ORIGINAL' -> '$SUBJECT'"
fi

# Final gate: the repaired subject must satisfy the real linter, or the
# caller gets a failure rather than a subject that only looks plausible.
"$LINT" --message "$SUBJECT" || {
  printf 'normalize: could not repair subject: %s\n' "$ORIGINAL" >&2
  exit 1
}

printf '%s\n' "$SUBJECT"

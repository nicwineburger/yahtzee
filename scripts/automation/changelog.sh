#!/usr/bin/env bash
# Grouped markdown changelog from conventional commits. Prints to stdout.
# Sections: Breaking Changes / Features / Bug Fixes / Performance / Maintenance.
# Non-conventional commits land in Maintenance tagged "(non-conventional)".
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: changelog.sh [--from <tag|ref>] [--to <ref>] [--version <vX.Y.Z>]
  --from  default: last release tag (all history if none)
  --to    default: HEAD
  --version  adds a "## vX.Y.Z (date)" header
EOF
  exit 2
}

FROM="" TO=HEAD VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from)    FROM="${2-}"; shift ;;
    --to)      TO="${2-}"; shift ;;
    --version) VERSION="${2-}"; shift ;;
    *) usage ;;
  esac
  shift
done

if [ -z "$FROM" ]; then
  FROM="$(git -C "$ROOT" describe --tags --abbrev=0 --match "${RELEASE_TAG_PREFIX}[0-9]*" 2>/dev/null || true)"
fi
RANGE="$TO"
[ -n "$FROM" ] && RANGE="${FROM}..${TO}"

SLUG="$(repo_slug)"
TYPES_RE="$(commit_type_regex)"

if [ -n "$VERSION" ]; then
  printf '## %s (%s)\n\n' "$VERSION" "$(date +%Y-%m-%d)"
fi

git -C "$ROOT" log --format='%H%x1f%s%x1f%b%x1e' "$RANGE" | awk -v slug="$SLUG" -v types="$TYPES_RE" '
BEGIN { RS = "\x1e"; FS = "\x1f" }
{
  gsub(/^\n+/, "", $1)
  sha = $1; subj = $2; body = $3
  if (sha == "") next
  if (subj ~ /^Merge / || subj ~ /^chore\(release\):/ || subj ~ /^fixup!/ || subj ~ /^squash!/) next

  link = " ([" substr(sha, 1, 7) "](https://github.com/" slug "/commit/" sha "))"

  head_re = "^(" types ")(\\([^)]*\\))?!?: "
  if (match(subj, head_re)) {
    prefix = substr(subj, 1, RLENGTH)
    rest = substr(subj, RLENGTH + 1)
    type = prefix; sub(/[(!:].*/, "", type)
    scope = ""
    if (match(prefix, /\(([^)]*)\)/)) scope = substr(prefix, RSTART + 1, RLENGTH - 2)
    breaking = (prefix ~ /!: $/) || (body ~ /(^|\n)BREAKING[ -]CHANGE: /)

    entry = "- "
    if (scope != "") entry = entry "**" scope ":** "
    entry = entry rest link "\n"

    if      (breaking)           { brk = brk "- **" subj "**" link "\n" }
    else if (type == "feat")     { feats = feats entry }
    else if (type == "fix" || type == "revert") { fixes = fixes entry }
    else if (type == "perf")     { perfs = perfs entry }
    else                         { maint = maint entry }
  } else {
    maint = maint "- " subj " (non-conventional)" link "\n"
  }
}
END {
  if (brk   != "") printf "### Breaking Changes\n\n%s\n", brk
  if (feats != "") printf "### Features\n\n%s\n", feats
  if (fixes != "") printf "### Bug Fixes\n\n%s\n", fixes
  if (perfs != "") printf "### Performance\n\n%s\n", perfs
  if (maint != "") printf "### Maintenance\n\n%s\n", maint
}'

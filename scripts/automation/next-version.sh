#!/usr/bin/env bash
# Infer the next semver tag from conventional commits since the last tag.
#   breaking (!, or BREAKING CHANGE: body line) -> major
#   feat -> minor · fix/perf/revert -> patch · nothing releasable -> exit 3
# No tags yet -> INITIAL_VERSION (bump reported as "initial").
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: next-version.sh            # print next tag, e.g. v0.2.0
       next-version.sh --bump     # print major|minor|patch|initial
       next-version.sh --current  # print last release tag, or "none"
EOF
  exit 2
}

MODE=next
case "${1-}" in
  "") ;;
  --bump) MODE=bump ;;
  --current) MODE=current ;;
  *) usage ;;
esac

TYPES_RE="$(commit_type_regex)"
LAST="$(git -C "$ROOT" describe --tags --abbrev=0 --match "${RELEASE_TAG_PREFIX}[0-9]*" 2>/dev/null || true)"

if [ "$MODE" = current ]; then
  printf '%s\n' "${LAST:-none}"
  exit 0
fi

if [ -z "$LAST" ]; then
  if [ "$MODE" = bump ]; then printf 'initial\n'; else printf '%s%s\n' "$RELEASE_TAG_PREFIX" "$INITIAL_VERSION"; fi
  exit 0
fi

BUMP=""
for sha in $(git -C "$ROOT" rev-list "${LAST}..HEAD"); do
  subj="$(git -C "$ROOT" log -1 --format=%s "$sha")"
  type="$(printf '%s' "$subj" | sed -En "s/^(${TYPES_RE})(\([^)]*\))?!?:.*/\1/p")"
  [ -n "$type" ] || continue
  if printf '%s' "$subj" | grep -Eq "^(${TYPES_RE})(\([^)]*\))?!:" \
     || git -C "$ROOT" log -1 --format=%b "$sha" | grep -Eq '^BREAKING[ -]CHANGE: '; then
    BUMP=major
    break
  fi
  case "$type" in
    feat) BUMP=minor ;;
    fix|perf|revert) if [ -z "$BUMP" ]; then BUMP=patch; fi ;;
  esac
done

[ -n "$BUMP" ] || die 3 "no releasable commits (feat/fix/perf/revert/breaking) since $LAST"

if [ "$MODE" = bump ]; then
  printf '%s\n' "$BUMP"
  exit 0
fi

VER="${LAST#"$RELEASE_TAG_PREFIX"}"
IFS=. read -r MA MI PA <<<"$VER"
case "$BUMP" in
  major) MA=$((MA + 1)); MI=0; PA=0 ;;
  minor) MI=$((MI + 1)); PA=0 ;;
  patch) PA=$((PA + 1)) ;;
esac
printf '%s%s.%s.%s\n' "$RELEASE_TAG_PREFIX" "$MA" "$MI" "$PA"

#!/usr/bin/env bash
# Cut a release: tag DEFAULT_BRANCH, push the tag, create a GitHub Release
# with a generated changelog. Version from next-version.sh unless --version.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

usage() { echo "usage: release.sh [--dry-run] [--yes] [--version ${RELEASE_TAG_PREFIX}X.Y.Z]" >&2; exit 2; }

DRY=0 VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --yes) AUTOMATION_YES=1 ;;
    --version) VERSION="${2-}"; shift ;;
    *) usage ;;
  esac
  shift
done

require_gh
require_branch "$DEFAULT_BRANCH"
require_clean_tree
git -C "$ROOT" fetch origin --quiet
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$(git -C "$ROOT" rev-parse "origin/$DEFAULT_BRANCH")" ] \
  || die 4 "local $DEFAULT_BRANCH is not in sync with origin — pull/push first"

if [ -z "$VERSION" ]; then
  set +e
  VERSION="$("$SCRIPT_DIR/next-version.sh")"
  RC=$?
  set -e
  [ "$RC" = 0 ] || exit "$RC"   # propagates 3 = nothing to release
fi
case "$VERSION" in
  "$RELEASE_TAG_PREFIX"[0-9]*.[0-9]*.[0-9]*) ;;
  *) die 2 "version must look like ${RELEASE_TAG_PREFIX}X.Y.Z (got '$VERSION')" ;;
esac

git -C "$ROOT" rev-parse -q --verify "refs/tags/$VERSION" >/dev/null \
  && die 4 "tag $VERSION already exists locally"
git -C "$ROOT" ls-remote --tags origin "$VERSION" | grep -q . \
  && die 4 "tag $VERSION already exists on origin"

LAST="$("$SCRIPT_DIR/next-version.sh" --current)"
if [ "$LAST" != "none" ]; then
  "$SCRIPT_DIR/lint-commit.sh" --range "${LAST}..HEAD" >/dev/null 2>&1 \
    || warn "some commits since $LAST are not conventional (pre-automation history?) — they land under Maintenance"
fi

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT
"$SCRIPT_DIR/changelog.sh" --version "$VERSION" >"$NOTES"

if [ "$DRY" = 1 ]; then
  log "dry-run: would tag $VERSION at $(git -C "$ROOT" rev-parse --short HEAD) with notes:"
  cat "$NOTES"
  exit 0
fi

log "release notes for $VERSION:"
cat "$NOTES" >&2
confirm "Tag and publish release $VERSION?"

git -C "$ROOT" tag -a "$VERSION" -m "$VERSION"
git -C "$ROOT" push origin "$VERSION"
gh release create "$VERSION" --title "$VERSION" --notes-file "$NOTES"
log "released $VERSION"

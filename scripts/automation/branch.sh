#!/usr/bin/env bash
# Create a topic branch <type>/<issue#>-<slug> off a freshly fetched
# origin/DEFAULT_BRANCH. Prints the branch name on stdout.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  cat >&2 <<EOF
usage: branch.sh <type> <issue#|-> <slug words...>
  type   one of: $BRANCH_TYPES
  issue# GitHub issue number, or '-' for none
example: branch.sh feat 12 dark mode toggle   ->  feat/12-dark-mode-toggle
EOF
  exit 2
}

[ $# -ge 3 ] || usage
TYPE="$1" ISSUE="$2"
shift 2

printf ' %s ' "$BRANCH_TYPES" | grep -q " $TYPE " || usage
case "$ISSUE" in
  -|[0-9]*) ;;
  *) usage ;;
esac

SLUG="$(printf '%s' "$*" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
[ -n "$SLUG" ] || usage

if [ "$ISSUE" = "-" ]; then
  NAME="$TYPE/$SLUG"
else
  NAME="$TYPE/${ISSUE}-${SLUG}"
fi

require_clean_tree
git -C "$ROOT" fetch origin --quiet

git -C "$ROOT" show-ref --verify --quiet "refs/heads/$NAME" \
  && die 4 "branch '$NAME' already exists — switch to it with: git switch $NAME"

git -C "$ROOT" switch -c "$NAME" "origin/$DEFAULT_BRANCH" --no-track >&2
printf '%s\n' "$NAME"

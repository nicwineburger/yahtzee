#!/usr/bin/env bash
# Shared helpers for scripts/automation/*. Source this; don't execute it.
#
# Exit codes used by every script in this directory:
#   0 success · 1 validation/lint failure · 2 usage error
#   3 nothing to do · 4 environment problem

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 4
}

CONF="$ROOT/.automation.conf"
[ -f "$CONF" ] || { echo "error: missing $CONF" >&2; exit 4; }
# shellcheck source=/dev/null
. "$CONF"

_color() {
  # $1 = ANSI code, $2 = text; colors only when stderr is a tty
  if [ -t 2 ]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi
}
log()  { printf '%s %s\n' "$(_color 36 '::')" "$*" >&2; }
warn() { printf '%s %s\n' "$(_color 33 'warn:')" "$*" >&2; }
die()  { local code="$1"; shift; printf '%s %s\n' "$(_color 31 'error:')" "$*" >&2; exit "$code"; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 \
      || die 4 "required command '$c' not found. Install it (e.g. brew install $c)."
  done
}

GH_MIN_VERSION="2.40.0"

gh_version_ok() {
  local v
  v="$(gh --version 2>/dev/null | awk 'NR==1{print $3}')"
  [ -n "$v" ] || return 1
  awk -v have="$v" -v need="$GH_MIN_VERSION" '
    function pad(s,  a) { split(s, a, "."); return sprintf("%03d%03d%03d", a[1], a[2], a[3]) }
    BEGIN { exit (pad(have) >= pad(need)) ? 0 : 1 }'
}

require_gh() {
  require_cmd gh jq
  gh_version_ok \
    || die 4 "gh $(gh --version 2>/dev/null | awk 'NR==1{print $3}') is too old (need >= $GH_MIN_VERSION). Run: brew upgrade gh"
  gh auth status >/dev/null 2>&1 \
    || die 4 "GitHub CLI not authenticated (token expired?). Run: gh auth login"
}

repo_slug() {
  # owner/repo derived from origin; works unauthenticated
  local url
  url="$(git -C "$ROOT" remote get-url origin 2>/dev/null)" \
    || die 4 "no 'origin' remote configured"
  case "$url" in
    git@*:*)  printf '%s\n' "${url#*:}"   | sed 's/\.git$//' ;;
    http*)    printf '%s\n' "$url" | sed -E 's#https?://[^/]+/##; s/\.git$//' ;;
    *)        die 4 "cannot parse origin remote url: $url" ;;
  esac
}

require_clean_tree() {
  git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet \
    || die 4 "working tree has uncommitted changes — commit or stash first"
}

require_branch() {
  local want="$1" cur
  cur="$(git -C "$ROOT" branch --show-current)"
  [ "$cur" = "$want" ] || die 4 "must be on branch '$want' (currently on '${cur:-detached HEAD}')"
}

confirm() {
  # Auto-confirms when AUTOMATION_YES=1 (set by skills only after the user gate).
  [ "${AUTOMATION_YES:-0}" = "1" ] && return 0
  local reply
  printf '%s [y/N] ' "$1" >&2
  read -r reply
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) die 1 "aborted" ;;
  esac
}

commit_type_regex() { printf '%s' "$COMMIT_TYPES" | tr ' ' '|'; }

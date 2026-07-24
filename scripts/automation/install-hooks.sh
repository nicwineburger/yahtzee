#!/usr/bin/env bash
# One-time per-clone setup: route git hooks through .githooks/ and set the
# conventional-commit message template. Idempotent. --uninstall reverts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

if [ "${1-}" = "--uninstall" ]; then
  git -C "$ROOT" config --unset core.hooksPath 2>/dev/null || true
  git -C "$ROOT" config --unset commit.template 2>/dev/null || true
  log "uninstalled: core.hooksPath and commit.template cleared"
  exit 0
fi

chmod +x "$ROOT/.githooks/"* "$SCRIPT_DIR"/*.sh
git -C "$ROOT" config core.hooksPath .githooks
git -C "$ROOT" config commit.template .gitmessage
log "core.hooksPath = .githooks (commit-msg lint active)"
log "commit.template = .gitmessage"

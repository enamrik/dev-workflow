#!/bin/sh
# dfl uninstaller (macOS / Linux)
# Removes the dfl install, launcher, global skills, and MCP registration. Preserves your data
# (~/.dfl/track) unless you pass --purge. Usage:
#   curl -fsSL https://enamrik.github.io/dev-workflow/uninstall.sh | sh
#   curl -fsSL https://enamrik.github.io/dev-workflow/uninstall.sh | sh -s -- --purge
set -eu

DFL_DIR="${DFL_INSTALL_DIR:-$HOME/.dfl}"
BIN_DIR="${DFL_BIN_DIR:-$HOME/.local/bin}"

PURGE=0
for arg in "$@"; do
  [ "$arg" = "--purge" ] && PURGE=1
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
ok() { printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%b⚠%b %s\n" "$YELLOW" "$NC" "$1"; }

info "Uninstalling dfl..."

# Launcher.
rm -f "$BIN_DIR/dfl"
ok "Removed launcher"

# Install dir. Data lives in $DFL_DIR/track and is left intact.
rm -rf "$DFL_DIR/install"
ok "Removed install dir"

# Global skills.
if [ -d "$HOME/.claude/skills" ]; then
  rm -rf "$HOME"/.claude/skills/dfl-*
  ok "Removed dfl-* skills from ~/.claude/skills"
fi

# Global MCP registration (best-effort, all scopes).
if command -v claude >/dev/null 2>&1; then
  for scope in user local project; do
    claude mcp remove dev-workflow-tracker --scope "$scope" >/dev/null 2>&1 || true
  done
  ok "Removed MCP registration"
fi

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$DFL_DIR/track"
  rmdir "$DFL_DIR" 2>/dev/null || true
  warn "Purged all data ($DFL_DIR/track)"
else
  info "Data preserved at $DFL_DIR/track. Re-run with --purge to delete it."
fi

printf "\n%bUninstall complete.%b\n" "$GREEN" "$NC"

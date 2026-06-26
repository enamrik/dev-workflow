#!/bin/sh
# dev-workflow installer (macOS / Linux)
# Downloads a self-contained, per-platform artifact from GitHub Releases — no npm registry
# access required (works behind corporate npm proxies). Usage:
#   curl -fsSL https://enamrik.github.io/dev-workflow/install.sh | sh
set -eu

REPO="enamrik/dev-workflow"
# ~/.dfl holds both the install (~/.dfl/install) and data (~/.dfl/track). Only the install
# subdir is replaced on (re)install; track/ is left untouched.
DFL_DIR="${DFL_INSTALL_DIR:-$HOME/.dfl}"
INSTALL_DIR="$DFL_DIR/install"
BIN_DIR="${DFL_BIN_DIR:-$HOME/.local/bin}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
ok() { printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%b⚠%b %s\n" "$YELLOW" "$NC" "$1"; }
die() { printf "%bError:%b %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

info "Installing dev-workflow..."

# Node.js is required to run the CLI (a Node app); we don't install deps via npm.
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required. Install from https://nodejs.org"
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required (found $(node -v))"
ok "Node.js $(node -v)"

# Detect platform → artifact slug.
OS=$(uname -s); ARCH=$(uname -m)
case "$OS" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "Unsupported OS: $OS (use install.ps1 on Windows)" ;;
esac
case "$ARCH" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) die "Unsupported architecture: $ARCH" ;;
esac
SLUG="${os}-${arch}"
ASSET="dev-workflow-${SLUG}.tar.gz"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
ok "Platform ${SLUG}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
info "Downloading ${ASSET}..."
curl -fsSL "$URL" -o "$TMP/$ASSET" || die "Download failed: $URL"
# Verify checksum when published alongside the asset.
if curl -fsSL "${URL}.sha256" -o "$TMP/$ASSET.sha256" 2>/dev/null; then
  EXPECTED=$(awk '{print $1}' "$TMP/$ASSET.sha256")
  if command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')
  else ACTUAL=$(sha256sum "$TMP/$ASSET" | awk '{print $1}'); fi
  [ "$EXPECTED" = "$ACTUAL" ] || die "Checksum mismatch for $ASSET — corrupt or incomplete download; retry"
  ok "Checksum verified"
fi

# Extract, replacing any prior install.
info "Installing to ${INSTALL_DIR}..."
# Replace only the install dir; preserve sibling data in $DFL_DIR/track. The archive's single
# top-level dir is "install", so extracting into $DFL_DIR yields $DFL_DIR/install.
rm -rf "$INSTALL_DIR"
mkdir -p "$DFL_DIR"
tar -xzf "$TMP/$ASSET" -C "$DFL_DIR"

# Write a launcher with the absolute cli.js path. (A symlink to the bundled wrapper
# would break: the wrapper derives its dir from $0, which is the symlink's location.)
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/dfl" <<EOF
#!/bin/sh
exec node "$INSTALL_DIR/cli.js" "\$@"
EOF
chmod +x "$BIN_DIR/dfl"
ok "Installed launcher at $BIN_DIR/dfl"

# Install skills globally so they apply across all projects (Claude Code loads
# ~/.claude/skills everywhere). Updating the tool thus updates skills for every project.
SKILLS_SRC="$INSTALL_DIR/skills"
if [ -d "$SKILLS_SRC" ]; then
  mkdir -p "$HOME/.claude/skills"
  cp -R "$SKILLS_SRC"/. "$HOME/.claude/skills/"
  ok "Installed skills to ~/.claude/skills"
fi

if ! command -v dfl >/dev/null 2>&1; then
  warn "$BIN_DIR is not on your PATH. Add it:"
  printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
fi

printf "\n%bInstallation complete!%b\n\n" "$GREEN" "$NC"
echo "Next steps:"
echo "  1. cd into your git repository"
echo "  2. Run: dfl init"
echo ""
echo "Docs: https://enamrik.github.io/dev-workflow"

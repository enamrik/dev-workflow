#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO="enamrik/dev-workflow"

echo -e "${BLUE}Installing dev-workflow...${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Error: Node.js 20+ required (found v${NODE_VERSION})${NC}"
    echo "Update Node.js from https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: Git is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Git $(git --version | cut -d' ' -f3)"

# Download and install from GitHub Releases
echo ""
echo "Downloading latest release..."

DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/dev-workflow-cli.tgz"
TMP_DIR=$(mktemp -d)
TMP_FILE="$TMP_DIR/dev-workflow-cli.tgz"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"; then
    echo -e "${RED}Error: Failed to download release${NC}"
    echo "Check if a release exists at: https://github.com/${REPO}/releases"
    rm -rf "$TMP_DIR"
    exit 1
fi

echo "Installing globally..."
npm install -g "$TMP_FILE"
rm -rf "$TMP_DIR"

# Verify installation
if ! command -v dev-workflow &> /dev/null; then
    echo -e "${RED}Error: Installation failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} dev-workflow $(dev-workflow --version 2>/dev/null || echo 'installed')"

# Check optional dependencies
echo ""
echo "Checking optional dependencies..."

if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓${NC} Claude CLI installed"
else
    echo -e "${YELLOW}⚠${NC} Claude CLI not found"
    echo "  Install: npm i -g @anthropic-ai/claude-code"
fi

if command -v gh &> /dev/null; then
    echo -e "${GREEN}✓${NC} GitHub CLI installed"
else
    echo -e "${YELLOW}⚠${NC} GitHub CLI not found"
    echo "  Install: https://cli.github.com"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. cd into your git repository"
echo "  2. Run: dev-workflow init"
echo ""
echo "Docs: https://enamrik.github.io/dev-workflow"

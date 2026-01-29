#!/bin/bash

# Test script to verify npm install works correctly
# This simulates what happens when users install dev-workflow via npm

set -e

echo "🧪 Testing npm install scenario..."
echo ""

# Create temp directory
TEST_DIR=$(mktemp -d)
echo "📁 Test directory: $TEST_DIR"
cd "$TEST_DIR"

# Get the project root
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo ""
echo "📦 Step 1: Building and packing packages..."
cd "$PROJECT_ROOT"
pnpm build

# Pack the packages
echo ""
echo "📦 Step 2: Creating tarballs..."
cd "$PROJECT_ROOT/apps/mcp-server"
MCP_TARBALL=$(pnpm pack --pack-destination "$TEST_DIR" 2>&1 | grep "\.tgz" | awk '{print $NF}')
echo "   Created: $MCP_TARBALL"

cd "$PROJECT_ROOT/apps/cli"
CLI_TARBALL=$(pnpm pack --pack-destination "$TEST_DIR" 2>&1 | grep "\.tgz" | awk '{print $NF}')
echo "   Created: $CLI_TARBALL"

echo ""
echo "📥 Step 3: Installing from tarballs..."
cd "$TEST_DIR"

# Create a test package.json
cat > package.json << EOF
{
  "name": "test-install",
  "version": "1.0.0",
  "private": true
}
EOF

# Install the packages
npm install "$MCP_TARBALL"
npm install "$CLI_TARBALL"

echo ""
echo "🔍 Step 4: Checking better-sqlite3 bindings..."
if [ -f "node_modules/@dev-workflow/mcp-server/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ] || \
   [ -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
    echo "   ✓ better-sqlite3 native bindings found"
else
    echo "   ⚠️  better-sqlite3 native bindings NOT found"
    echo "   This may be expected if prebuild-install found compatible binaries"
fi

echo ""
echo "🚀 Step 5: Testing dev-workflow init..."
node node_modules/@dev-workflow/cli/dist/index.js init

echo ""
echo "🔍 Step 6: Verifying database..."
if [ -f ".track/data/workflow.db" ]; then
    echo "   ✓ Database created"
    ISSUE_COUNT=$(sqlite3 .track/data/workflow.db "SELECT COUNT(*) FROM issues;")
    echo "   ✓ Issue count: $ISSUE_COUNT"
else
    echo "   ❌ Database NOT created"
    exit 1
fi

echo ""
echo "✅ npm install test PASSED!"
echo ""
echo "Test artifacts in: $TEST_DIR"
echo "To clean up: rm -rf $TEST_DIR"

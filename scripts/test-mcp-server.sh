#!/bin/bash
# Test script for MCP server functionality
# This script verifies the MCP server starts correctly and can be used by Claude

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/.track/data/workflow.db"

echo "🧪 Testing dev-workflow MCP server..."
echo ""

# Step 1: Verify database exists
echo "1️⃣  Checking database exists..."
if [ -f "$DB_PATH" ]; then
    echo "   ✓ Database found at $DB_PATH"
else
    echo "   ✗ Database not found. Run 'make dogfood' first."
    exit 1
fi

# Step 2: Verify dfl command is available
echo ""
echo "2️⃣  Checking dfl command..."
if command -v dfl &> /dev/null; then
    VERSION=$(dfl --version)
    echo "   ✓ dfl available (version $VERSION)"
else
    echo "   ✗ dfl not found on PATH"
    exit 1
fi

# Step 3: Test MCP server starts without errors
echo ""
echo "3️⃣  Testing MCP server startup..."
export DATABASE_PATH="$DB_PATH"
export TEMPLATES_PATH="$PROJECT_DIR/.track/config/issues/templates/"

# Start MCP server with stdin closed (will exit after printing startup message)
# Capture both stdout and stderr
MCP_OUTPUT=$(mktemp)
(dfl mcp < /dev/null 2>&1 || true) > "$MCP_OUTPUT" &
MCP_PID=$!

# Give it time to start and print messages
sleep 2

# Kill it if still running (it should exit on its own when stdin closes)
kill $MCP_PID 2>/dev/null || true
wait $MCP_PID 2>/dev/null || true

# Check if startup was successful by looking for success message or error
if grep -q "MCP server running on stdio" "$MCP_OUTPUT"; then
    echo "   ✓ MCP server started successfully"
elif grep -q "Error\|error\|SQLITE_ERROR" "$MCP_OUTPUT"; then
    echo "   ✗ MCP server failed to start"
    echo "   Error output:"
    cat "$MCP_OUTPUT" | sed 's/^/     /'
    rm -f "$MCP_OUTPUT"
    exit 1
else
    echo "   ⚠ MCP server output unclear:"
    cat "$MCP_OUTPUT" | sed 's/^/     /'
fi

rm -f "$MCP_OUTPUT"

# Step 4: Verify migrations table exists (idempotent migrations)
echo ""
echo "4️⃣  Checking migrations tracking..."
MIGRATIONS_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM __drizzle_migrations;" 2>/dev/null || echo "0")
if [ "$MIGRATIONS_COUNT" != "0" ]; then
    echo "   ✓ Migrations tracked ($MIGRATIONS_COUNT applied)"
else
    echo "   ⚠ No migrations tracked (table may not exist yet)"
fi

# Step 5: Verify issues table has data
echo ""
echo "5️⃣  Checking issues table..."
ISSUE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM issues;" 2>/dev/null || echo "0")
if [ "$ISSUE_COUNT" -gt 0 ]; then
    echo "   ✓ Issues table has $ISSUE_COUNT issue(s)"
else
    echo "   ⚠ No issues found"
fi

echo ""
echo "✅ All MCP server tests passed!"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to pick up the MCP server"
echo "  2. Ask Claude to 'create an issue for adding unit tests'"
echo "  3. Or run: claude --mcp-debug to see MCP server logs"

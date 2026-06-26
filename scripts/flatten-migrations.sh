#!/bin/bash
#
# Flatten all database migrations into a single migration file.
#
# This script:
# 1. Verifies the database is in sync with current migrations
# 2. Deletes all migration files
# 3. Generates a single new migration from the current schema
# 4. Updates the migrations table to reference the new migration
#
# Usage: ./scripts/flatten-migrations.sh [--force]
#
# Options:
#   --force    Skip the database sync check (use when you know what you're doing)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATABASE_PKG="$PROJECT_ROOT/packages/database"
DRIZZLE_DIR="$DATABASE_PKG/drizzle"
DB_PATH="$HOME/.track/workflow.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_error() { echo -e "${RED}ERROR:${NC} $1" >&2; }
echo_warn() { echo -e "${YELLOW}WARNING:${NC} $1"; }
echo_success() { echo -e "${GREEN}✓${NC} $1"; }

# Parse arguments
FORCE=false
for arg in "$@"; do
    case $arg in
        --force)
            FORCE=true
            shift
            ;;
    esac
done

# Check if database exists
if [[ ! -f "$DB_PATH" ]]; then
    echo_error "Database not found at $DB_PATH"
    echo "Run 'dwf init' first to create the database."
    exit 1
fi

# Count current migration files
MIGRATION_COUNT=$(find "$DRIZZLE_DIR" -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
echo "Found $MIGRATION_COUNT migration file(s) in $DRIZZLE_DIR"

if [[ "$MIGRATION_COUNT" -eq 0 ]]; then
    echo_error "No migrations found. Nothing to flatten."
    exit 1
fi

# Check if database is in sync with migrations (unless --force)
if [[ "$FORCE" != true ]]; then
    echo "Checking if database is in sync with migrations..."

    # Get count of applied migrations from database
    APPLIED_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM __drizzle_migrations;" 2>/dev/null || echo "0")

    if [[ "$APPLIED_COUNT" -ne "$MIGRATION_COUNT" ]]; then
        echo_error "Database has $APPLIED_COUNT applied migrations but there are $MIGRATION_COUNT migration files."
        echo ""
        echo "The database must be in sync with all migrations before flattening."
        echo "Options:"
        echo "  1. Run 'dwf update' to apply pending migrations first"
        echo "  2. Use --force to skip this check (only if you know what you're doing)"
        exit 1
    fi

    echo_success "Database is in sync ($APPLIED_COUNT migrations applied)"
fi

# Confirm action
echo ""
echo_warn "This will:"
echo "  1. Delete all migration files in $DRIZZLE_DIR"
echo "  2. Generate a single new migration from the current schema"
echo "  3. Update the migrations table in $DB_PATH"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Step 1: Delete existing migrations
echo ""
echo "Deleting existing migrations..."
rm -rf "$DRIZZLE_DIR"/*
echo_success "Deleted migration files"

# Step 2: Generate new flattened migration
echo "Generating flattened migration..."
cd "$CORE_PKG"
pnpm drizzle-kit generate
echo_success "Generated flattened migration"

# Step 3: Find the new migration file and compute its hash
NEW_MIGRATION=$(find "$DRIZZLE_DIR" -name "*.sql" | head -1)
if [[ -z "$NEW_MIGRATION" ]]; then
    echo_error "No migration file generated!"
    exit 1
fi

NEW_HASH=$(shasum -a 256 "$NEW_MIGRATION" | cut -d' ' -f1)
TIMESTAMP=$(date +%s)000

echo "New migration: $(basename "$NEW_MIGRATION")"
echo "Hash: $NEW_HASH"

# Step 4: Update the migrations table
echo "Updating migrations table..."
sqlite3 "$DB_PATH" "
DELETE FROM __drizzle_migrations;
INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (NULL, '$NEW_HASH', $TIMESTAMP);
"
echo_success "Updated migrations table"

# Verify
FINAL_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM __drizzle_migrations;")
echo ""
echo_success "Flattening complete!"
echo "  Migration files: 1"
echo "  Applied migrations in DB: $FINAL_COUNT"

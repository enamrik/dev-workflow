#!/bin/bash
# Set up a local .track/ directory for isolated testing
# This enables testing schema changes, new features, and UI without affecting production data

set -e

# Get the main repo path (works even when run from a worktree)
get_git_root() {
    dirname "$(git rev-parse --path-format=absolute --git-common-dir)"
}

# Compute project ID matching TrackDirectoryResolver logic
# Format: <folder-name>-<6-char-first-commit-hash>
get_project_id() {
    local git_root="$1"
    local folder_name
    local first_commit_hash
    folder_name=$(basename "$git_root")
    # Get the first (initial) commit hash - this is stable and never changes
    first_commit_hash=$(git -C "$git_root" rev-list --max-parents=0 HEAD 2>/dev/null | head -1 | cut -c1-6)
    if [ -z "$first_commit_hash" ]; then
        # Fallback to path-based hash if git command fails
        first_commit_hash=$(printf '%s' "$git_root" | shasum -a 256 | cut -c1-6)
    fi
    echo "${folder_name}-${first_commit_hash}"
}

echo "📁 Setting up local .track/ directory for isolated testing..."

# Check prerequisites
if [ ! -d "$HOME/.track" ]; then
    echo "❌ Error: ~/.dwf/track does not exist. Run 'dwf init' first."
    exit 1
fi

if [ ! -f "$HOME/.track/workflow.db" ]; then
    echo "❌ Error: ~/.dwf/track/workflow.db does not exist. Run 'dwf init' first."
    exit 1
fi

# Compute project ID
GIT_ROOT=$(get_git_root)
PROJECT_ID=$(get_project_id "$GIT_ROOT")
echo "   Project ID: $PROJECT_ID"

# Create local .track directory
mkdir -p .track

# Copy database (including WAL files for complete data)
echo "   Copying workflow.db..."
cp "$HOME/.track/workflow.db" .track/workflow.db
# Copy WAL files if they exist (SQLite WAL mode stores uncommitted data here)
if [ -f "$HOME/.track/workflow.db-wal" ]; then
    cp "$HOME/.track/workflow.db-wal" .track/workflow.db-wal
fi
if [ -f "$HOME/.track/workflow.db-shm" ]; then
    cp "$HOME/.track/workflow.db-shm" .track/workflow.db-shm
fi

# Copy project config if it exists (exclude worktrees - they can be huge)
# Project directories are now at ~/.dwf/track/projects/$PROJECT_ID/ (since PR #460)
if [ -d "$HOME/.track/projects/$PROJECT_ID" ]; then
    echo "   Copying project config..."
    mkdir -p ".track/projects/$PROJECT_ID"
    # Copy each subdirectory except worktrees
    for item in "$HOME/.track/projects/$PROJECT_ID"/*; do
        base=$(basename "$item")
        if [ "$base" != "worktrees" ]; then
            cp -R "$item" ".track/projects/$PROJECT_ID/"
        fi
    done
else
    echo "⚠️  Warning: No project config found at ~/.dwf/track/projects/$PROJECT_ID"
fi

echo ""
echo "✓ Local .track/ directory created!"
echo ""
echo "To use local data, set the DWF_HOME environment variable:"
echo ""
echo "  export DWF_HOME=$(pwd)/.track"
echo ""
echo "Examples:"
echo "  DWF_HOME=.track dwf ui           # Start UI with local data"
echo "  DWF_HOME=.track pnpm --filter @dev-workflow/web dev  # Dev mode"
echo ""
echo "Or use 'make ui-dev-local' for convenience."

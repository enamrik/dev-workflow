#!/bin/bash
# Set up a local .track/ directory for isolated testing
# This enables testing schema changes, new features, and UI without affecting production data

set -e

# Get the main repo path (works even when run from a worktree)
get_git_root() {
    dirname "$(git rev-parse --path-format=absolute --git-common-dir)"
}

# Compute project ID matching TrackDirectoryResolver logic
# Format: <folder-name>-<6-char-sha256-hash>
get_project_id() {
    local git_root="$1"
    local folder_name
    local hash
    folder_name=$(basename "$git_root")
    hash=$(printf '%s' "$git_root" | shasum -a 256 | cut -c1-6)
    echo "${folder_name}-${hash}"
}

echo "📁 Setting up local .track/ directory for isolated testing..."

# Check prerequisites
if [ ! -d "$HOME/.track" ]; then
    echo "❌ Error: ~/.track does not exist. Run 'dev-workflow init' first."
    exit 1
fi

if [ ! -f "$HOME/.track/workflow.db" ]; then
    echo "❌ Error: ~/.track/workflow.db does not exist. Run 'dev-workflow init' first."
    exit 1
fi

# Compute project ID
GIT_ROOT=$(get_git_root)
PROJECT_ID=$(get_project_id "$GIT_ROOT")
echo "   Project ID: $PROJECT_ID"

# Create local .track directory
mkdir -p .track

# Copy database
echo "   Copying workflow.db..."
cp "$HOME/.track/workflow.db" .track/workflow.db

# Copy project config if it exists
if [ -d "$HOME/.track/$PROJECT_ID" ]; then
    echo "   Copying project config..."
    cp -R "$HOME/.track/$PROJECT_ID" .track/
else
    echo "⚠️  Warning: No project config found at ~/.track/$PROJECT_ID"
fi

echo ""
echo "✓ Local .track/ directory created!"
echo ""
echo "To use local data, set the TRACK_DIR environment variable:"
echo ""
echo "  export TRACK_DIR=$(pwd)/.track"
echo ""
echo "Examples:"
echo "  TRACK_DIR=.track dev-workflow ui           # Start UI with local data"
echo "  TRACK_DIR=.track pnpm --filter @dev-workflow/web dev  # Dev mode"
echo ""
echo "Or use 'make ui-dev-local' for convenience."

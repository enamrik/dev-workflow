#!/bin/bash
# Start UI dev server with local test data
# Calculates a unique port based on worktree name (issue + task number)

set -e

# Extract issue and task numbers from current directory name
# e.g., issue-54-task-1 -> issue=54, task=1
DIRNAME=$(basename "$(pwd)")
ISSUE_NUM=$(echo "$DIRNAME" | grep -oE 'issue-[0-9]+' | grep -oE '[0-9]+' || echo "")
TASK_NUM=$(echo "$DIRNAME" | grep -oE 'task-[0-9]+' | grep -oE '[0-9]+' || echo "")

# Calculate port: 3500 + (issue % 50) + (task * 50)
# This gives each issue 50 ports (tasks 0-49) and ensures different tasks get different ports
if [ -n "$ISSUE_NUM" ]; then
  if [ -n "$TASK_NUM" ]; then
    PORT=$((3500 + (ISSUE_NUM % 50) + (TASK_NUM * 50)))
    echo "🔧 Detected worktree for issue #$ISSUE_NUM, task #$TASK_NUM"
  else
    PORT=$((3500 + (ISSUE_NUM % 50)))
    echo "🔧 Detected worktree for issue #$ISSUE_NUM"
  fi
  QUERY="?issue=$ISSUE_NUM"
else
  PORT=3457
  QUERY=""
fi

# Kill any existing process on the port
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true

echo "🧹 Clearing Next.js cache..."
rm -rf apps/web/.next apps/web/node_modules/.cache

echo "🔥 Starting UI in dev mode with local data..."
echo "   http://localhost:$PORT$QUERY"
echo "   Using: TRACK_DIR=$(pwd)/.track"

# Open browser when server is ready
(cd apps/web && npx wait-on tcp:"$PORT" && open "http://localhost:$PORT$QUERY") &

# Start the dev server
TRACK_DIR="$(pwd)/.track" PORT="$PORT" pnpm --filter @dev-workflow/web dev

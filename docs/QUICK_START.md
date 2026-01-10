# Quick Start Tutorial

This tutorial walks you through a complete dev-workflow cycle: from initializing a project to merging your first PR.

## Prerequisites

- Node.js 18+
- Git repository
- Claude Code CLI installed and configured
- GitHub repository (optional, for PR workflow)

## Step 1: Initialize dev-workflow

Navigate to your project and run:

```bash
dev-workflow init
```

**Expected output:**

```
✓ Created .track/ directory
✓ Initialized database at .track/workflow.db
✓ Installed default templates
✓ Installed Claude skills to .claude/skills/
✓ Registered MCP server in .claude/config/mcp-servers.json
✓ Created welcome issue #1

dev-workflow initialized successfully!
```

This creates the necessary configuration and registers the MCP server with Claude Code.

## Step 2: Create an Issue

Start Claude Code in your project directory. Create an issue using natural language:

```
> I want to add a /health endpoint that returns the server status
```

Claude will invoke the `dwf-work-request` skill automatically and create a structured issue:

**Expected output:**

```
Created issue #2: Add /health endpoint for server status

Type: FEATURE
Priority: MEDIUM

Acceptance Criteria:
- GET /health returns 200 OK with status JSON
- Response includes uptime and version info
- Endpoint requires no authentication
```

## Step 3: Plan the Issue

Ask Claude to create an implementation plan:

```
> Plan issue #2
```

Claude will analyze the issue and generate a plan with discrete tasks:

**Expected output:**

```
Generated plan for issue #2

Summary: Add health check endpoint with status information

Tasks:
1. Create health route handler with status response
2. Add uptime tracking to application startup
3. Write integration tests for health endpoint

Estimated complexity: LOW

Does this plan look good? Say 'yes' to approve, or suggest changes.
```

Approve the plan:

```
> Yes, looks good
```

Claude will activate the plan, transitioning tasks from PLANNED to BACKLOG status.

## Step 4: Start a Task

Begin working on the first task:

```
> Start task #2.1
```

Claude loads the task session and creates an isolated worktree:

**Expected output:**

```
Starting task #2.1: Create health route handler

Mode: isolated
Worktree: ~/.track/your-project/worktrees/issue-2-task-1
Branch: issue-2/task-1-create-health-route

Acceptance Criteria:
- [ ] GET /health returns 200 with JSON body
- [ ] Response includes { status: 'ok', timestamp: ... }

Ready to implement. What would you like me to do first?
```

## Step 5: Implement the Task

Work with Claude to implement the feature:

```
> Create the health endpoint in src/routes/health.ts
```

Claude will create the file and implement the endpoint:

```typescript
// src/routes/health.ts
import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

export default router;
```

## Step 6: Create a PR

Once implementation is complete:

```
> Create a PR for this task
```

Claude commits the changes, pushes the branch, and creates a PR:

**Expected output:**

```
Created PR #15: [#42] Create health route handler

Branch: issue-2/task-1-create-health-route → main
URL: https://github.com/your-org/your-project/pull/15

Summary:
- Added /health endpoint with status response
- Returns uptime, version, and timestamp

Task status: IN_PROGRESS
Submit for review?
```

## Step 7: Submit for Review

```
> Yes, submit for review
```

**Expected output:**

```
Submitted for review.

Task status: PR_REVIEW
PR #15 is ready for review.

Once the PR is merged, say "complete the task" to finish.
```

## Step 8: Complete the Task

After the PR is merged on GitHub:

```
> Complete the task
```

Claude verifies the PR is merged, cleans up the worktree/branch, and marks the task complete:

**Expected output:**

```
Task #2.1 completed!

PR #15: MERGED
Worktree cleaned up
Branch deleted

Next available task: #2.2 - Add uptime tracking to application startup
```

## Step 9: Continue or Close

Work through remaining tasks the same way. When all tasks are complete:

```
> Complete the task
```

**Expected output:**

```
Task #2.3 completed!

All tasks for issue #2 are now complete.
Would you like to close the issue?
```

```
> Yes, close it
```

**Expected output:**

```
Issue #2 closed.

Summary:
- 3 tasks completed
- 3 PRs merged
- Health endpoint feature shipped!
```

## What's Next?

- **[MCP Tools Reference](MCP_TOOLS.md)** - Explore all 55+ available tools
- **[Task Execution Guide](TASK_EXECUTION.md)** - Learn about execution modes
- **[GitHub Integration](GITHUB_INTEGRATION.md)** - Set up two-way sync
- **[Configuration Guide](CONFIGURATION.md)** - Customize templates and settings

## Tips

1. **Use natural language** - Claude understands intent; you don't need exact commands
2. **Check the work queue** - Say "show work queue" to see prioritized tasks
3. **Isolated mode is default** - Each task gets its own worktree for parallel work
4. **Progress is tracked** - Resume tasks anytime with "continue task #X"
5. **Enable GitHub sync** - Get automatic issue/task sync with GitHub Projects

---
sidebar_position: 3
---

# Task Execution

This guide covers the complete task lifecycle from starting work to merging your PR.

## Git Isolation

Tasks execute in git worktrees for fully parallel work:

```
main repo                  worktree
─────────                 ─────────────────────────────
main branch  ────┐        issue-5/task-1-add-oauth
                 │        └── ~/.dfl/track/project/worktrees/issue-5-task-1/
                 └────────    (separate working directory)
```

| Aspect            | Details                        |
| ----------------- | ------------------------------ |
| **Git setup**     | Creates worktree + branch      |
| **Isolation**     | Changes don't affect main repo |
| **Parallel work** | Multiple tasks simultaneously  |
| **PR workflow**   | Full PR lifecycle support      |

:::warning Important
All file operations must use the worktree path returned by `load_task_session`. Never use the main repo path during task execution.
:::

## Task Lifecycle

```
PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED
                                   ↓
                              ABANDONED
```

### Status Definitions

| Status          | Meaning                                         |
| --------------- | ----------------------------------------------- |
| **PLANNED**     | Task exists but plan not approved               |
| **BACKLOG**     | Plan approved, task available but not started   |
| **READY**       | Dependencies complete, task ready for execution |
| **IN_PROGRESS** | Task is actively being worked on                |
| **PR_REVIEW**   | PR created and submitted for review             |
| **COMPLETED**   | PR merged, task done                            |
| **ABANDONED**   | Work stopped, reason documented                 |

### Status Transitions

| From        | To          | Trigger                 |
| ----------- | ----------- | ----------------------- |
| PLANNED     | BACKLOG     | `move_issue_to_backlog` |
| BACKLOG     | IN_PROGRESS | `load_task_session`     |
| READY       | IN_PROGRESS | `load_task_session`     |
| READY       | BACKLOG     | `pause_issue`           |
| IN_PROGRESS | PR_REVIEW   | `submit_for_review`     |
| PR_REVIEW   | COMPLETED   | `complete_task`         |
| Any         | ABANDONED   | `abandon_task`          |

## Starting a Task

### Using the Skill

```
> Start task #2.1
```

Claude invokes `dfl-work-task` which handles the full workflow.

### Using MCP Tools

```typescript
load_task_session({
  taskId: "task-uuid",
  sessionId: "your-session-id",
  mode: "isolated", // Default
});
```

### Execution Modes

| Mode       | Description                 | Use Case               |
| ---------- | --------------------------- | ---------------------- |
| `isolated` | New git worktree            | Default, parallel work |
| `branch`   | New branch in main worktree | Single task at a time  |
| `main`     | Work directly on main       | Quick fixes, testing   |

## Working on Tasks

### Implementing Changes

After starting a task:

1. **Read the context** - Task description, acceptance criteria, implementation plan
2. **Make changes** - Edit files in the worktree
3. **Test your work** - Run tests, verify functionality
4. **Log progress** - Record significant milestones

### Logging Progress

```typescript
log_task_progress({
  taskId: "task-uuid",
  sessionId: "session-id",
  message: "Implemented OAuth callback handler. Added tests.",
  filesModified: ["src/auth/callback.ts", "src/test/auth.test.ts"],
});
```

:::tip
Log at milestones only, not routine operations:

- Feature: 2-4 entries (approach, key milestones)
- Bug: 3-5 entries (hypotheses, root cause, fix)
- Simple: 0 entries - just use `finalLogEntry`
  :::

### Reading Progress

```typescript
get_task_execution_log({
  taskId: "task-uuid",
});
```

## PR Workflow

### Step 1: Create the PR

After implementing the task:

1. Run validation (tests, lint, typecheck)
2. Commit changes
3. Rebase on main
4. Create the PR

```typescript
create_pr({
  taskId: "task-uuid",
  title: "Add OAuth authentication", // Optional
  body: "## Summary\n...", // Optional
  draft: false, // Optional
});
```

### Step 2: Submit for Review

When ready for review:

```typescript
submit_for_review({
  taskId: "task-uuid",
});
```

This transitions the task to PR_REVIEW and updates GitHub.

### Step 3: Wait for Merge

The PR must be merged on GitHub before completing the task.

### Step 4: Complete the Task

After the PR is merged:

```typescript
complete_task({
  taskId: "task-uuid",
  sessionId: "session-id",
  finalLogEntry: "Implemented OAuth with Google provider. Added tests.",
});
```

This:

1. Verifies PR is merged
2. Pulls latest main
3. Cleans up worktree and branch
4. Writes final log entry
5. Marks task COMPLETED

## Session Ownership

Each task is owned by one session at a time:

| Scenario                | Result                   |
| ----------------------- | ------------------------ |
| Task is BACKLOG/READY   | Session claims ownership |
| Same session resumes    | Continues work           |
| Different session tries | Error - task locked      |

### Session Timeout

Sessions time out after 1 hour of inactivity. After timeout:

- Same session can resume
- Different session can force claim

## Resuming Tasks

Tasks can be resumed after interruption:

```typescript
// Resume (idempotent)
load_task_session({
  taskId: "task-uuid",
  sessionId: "new-session-id",
});

// Check previous work
get_task_execution_log({
  taskId: "task-uuid",
});
```

### What's Preserved

| Preserved               | Lost                             |
| ----------------------- | -------------------------------- |
| Git worktree and branch | Uncommitted changes (if crashed) |
| Previous commits        | Claude's context                 |
| Execution log entries   | -                                |
| Task status             | -                                |

## Conflict Detection

Check for conflicts before starting:

```typescript
check_task_conflicts({
  taskId: "task-uuid",
});
```

Returns warnings about files modified by prior completed tasks.

## Abandoning Tasks

Stop work on a task:

```typescript
abandon_task({
  taskId: "task-uuid",
  sessionId: "session-id",
  reason: "Requirements changed, will be handled in different issue",
});
```

This:

- Marks task ABANDONED
- Cleans up worktree/branch
- Records the reason

## Force Mode

Force mode bypasses state validation when state has drifted:

| Tool                | What force bypasses      |
| ------------------- | ------------------------ |
| `create_pr`         | IN_PROGRESS status check |
| `submit_for_review` | Status and PR existence  |
| `complete_task`     | Status check             |
| `abandon_task`      | Session ownership        |

:::caution
Never use force without explicit user confirmation. Always explain the state mismatch first.
:::

**Example:**

```
Error: Task must be in PR_REVIEW to complete. Current: IN_PROGRESS.

Checking GitHub... PR #42 is merged.

"The task shows IN_PROGRESS but the PR is merged. This happens when
the PR was merged outside the normal flow. Force-complete?"

User: "yes" → complete_task({ ..., force: true })
```

## Auto-Closing Issues

When `complete_task` returns `allTasksComplete: true`:

- All tasks in the issue are now COMPLETED or ABANDONED
- Ask user: "All tasks done. Close issue #N?"
- If confirmed, call `close_issue`

## Error Handling

### Common Errors

| Error                        | Cause                   | Solution                                |
| ---------------------------- | ----------------------- | --------------------------------------- |
| Task not found               | Stale UUID              | Use `get_task(issueNumber, taskNumber)` |
| Task in progress             | Another session owns it | Wait or force if stale                  |
| Create PR failed             | No worktree             | Start task first                        |
| Submit failed                | No PR                   | Create PR first                         |
| Complete failed - not merged | PR still open           | Merge on GitHub                         |

### MCP Server Issues (rare)

Project resolution is worktree-aware, so a session connecting to the wrong
database is now uncommon. As a backstop, if tools return "not found" for data
that should exist and normal recovery doesn't resolve it:

1. **Stop** - don't work around it
2. Tell user: "MCP server may be connected to wrong database. Please restart Claude session."
3. After restart, resume with `load_task_session`

:::danger
Never bypass MCP tools with direct database updates or `gh` CLI. This creates inconsistent state.
:::

## Summary

| Concept               | Key Points                                                      |
| --------------------- | --------------------------------------------------------------- |
| **Git isolation**     | Worktree + branch per task                                      |
| **Task lifecycle**    | PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED |
| **PR workflow**       | `create_pr` → `submit_for_review` → merge → `complete_task`     |
| **Session ownership** | One task per session, 1 hour timeout                            |
| **Progress logging**  | Milestones only, enables resume                                 |
| **Force mode**        | User confirmation required                                      |

## Next Steps

- [Set up GitHub integration](/user-guide/github-integration)
- [Use background workers](/advanced/workers)
- [Troubleshooting](/advanced/troubleshooting)

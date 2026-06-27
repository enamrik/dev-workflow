# Task Execution Guide

> This guide is part of the [dev-workflow documentation](../README.md).

This guide covers task execution, the complete task lifecycle, PR workflow, and session management.

## Git Isolation

Tasks execute in git worktrees for fully parallel work.

```
main repo                  worktree
─────────                 ─────────────────────────────
main branch  ────┐        issue-5/task-1-add-oauth
                 │        └── ~/.track/project/worktrees/issue-5-task-1/
                 └────────    (separate working directory)
```

| Aspect            | Details                                              |
| ----------------- | ---------------------------------------------------- |
| **Git setup**     | Creates worktree + branch                            |
| **Isolation**     | Fully isolated - changes don't affect main repo      |
| **Parallel work** | Multiple tasks can run simultaneously                |
| **PR workflow**   | Full workflow: create PR → review → merge → complete |

**Critical:** All file operations must use the worktree path returned by `load_task_session`. Never use the main repo path during task execution.

---

## Task Lifecycle

Tasks progress through a defined set of statuses from creation to completion.

```
PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED
                                   ↓
                              ABANDONED
```

### Status Definitions

| Status          | Meaning                                         |
| --------------- | ----------------------------------------------- |
| **PLANNED**     | Task exists but plan not yet approved           |
| **BACKLOG**     | Plan approved, task available but not started   |
| **READY**       | Dependencies complete, task ready for execution |
| **IN_PROGRESS** | Task is actively being worked on                |
| **PR_REVIEW**   | PR created and submitted for review             |
| **COMPLETED**   | PR merged (or committed on main), task done     |
| **ABANDONED**   | Work stopped, reason documented                 |

### Status Transitions

| From        | To          | Trigger                 | Notes                                     |
| ----------- | ----------- | ----------------------- | ----------------------------------------- |
| PLANNED     | BACKLOG     | `move_issue_to_backlog` | User approved plan; creates GitHub issues |
| BACKLOG     | IN_PROGRESS | `load_task_session`     | Also moves other BACKLOG tasks → READY    |
| READY       | IN_PROGRESS | `load_task_session`     | Task was waiting for dependencies         |
| READY       | BACKLOG     | `pause_issue`           | Deactivates issue for later               |
| IN_PROGRESS | PR_REVIEW   | `submit_for_review`     | After `create_pr`                         |
| PR_REVIEW   | COMPLETED   | `complete_task`         | After PR is merged                        |
| Any         | ABANDONED   | `abandon_task`          | Work stopped                              |

### Task Dependencies

Tasks can depend on other tasks. Dependencies affect when a task becomes READY.

```json
{
  "tasks": [
    { "id": "db", "title": "Add schema", "dependsOn": [] },
    { "id": "api", "title": "Implement API", "dependsOn": ["db"] },
    { "id": "ui", "title": "Build UI", "dependsOn": ["api"] }
  ]
}
```

**How it works:**

1. All tasks start as BACKLOG when plan is approved
2. When a task is started (`load_task_session`), other BACKLOG tasks move to READY
3. Tasks with incomplete dependencies stay in BACKLOG
4. When dependencies complete, dependent tasks become READY

| Task  | Can start when...             |
| ----- | ----------------------------- |
| `db`  | Immediately (no dependencies) |
| `api` | After `db` is COMPLETED       |
| `ui`  | After `api` is COMPLETED      |

---

## PR Workflow

Tasks go through a PR workflow before completion.

### Step 1: Create the PR

After implementing the task:

1. **Run validation** - Tests, linting, type checks
2. **Commit changes** - Stage and commit all work
3. **Rebase on main** - Ensure PR is up-to-date
4. **Call `create_pr`** - Pushes branch and creates PR

```typescript
create_pr({
  taskId: "task-uuid",
  title: "Add OAuth authentication", // Optional
  body: "## Summary\n...", // Optional
  draft: false, // Optional
});
```

**Result:** PR is created, task stays IN_PROGRESS.

### Step 2: Submit for Review

When ready for review:

```typescript
submit_for_review({
  taskId: "task-uuid",
});
```

**Result:** Task transitions to PR_REVIEW. If GitHub Projects integration is enabled, the card moves to the "In Review" column.

### Step 3: Wait for Merge

The task owner or reviewer merges the PR on GitHub. The PR must be merged before completion.

### Step 4: Complete the Task

After the PR is merged:

```typescript
complete_task({
  taskId: "task-uuid",
  sessionId: "session-id",
  finalLogEntry: "Implemented OAuth flow with Google provider. Added tests.",
});
```

**What happens:**

1. Verifies PR is merged
2. Pulls latest main
3. Cleans up worktree and branch
4. Writes final log entry
5. Marks task COMPLETED

**Result:** Task is COMPLETED. Returns `allTasksComplete: true/false` to indicate if the parent issue can be closed.

---

## Session Ownership

Each task session is owned by a Claude session. This prevents conflicts when multiple sessions work on different tasks.

### How Session Ownership Works

```typescript
load_task_session({
  taskId: "task-uuid",
  sessionId: "claude-session-id", // Links session to task
});
```

| Scenario                               | Result                                       |
| -------------------------------------- | -------------------------------------------- |
| Task is BACKLOG/READY                  | Session claims ownership, task → IN_PROGRESS |
| Task is IN_PROGRESS, same session      | Resumes work                                 |
| Task is IN_PROGRESS, different session | Error - task locked                          |
| Task is already completed              | Error - no action needed                     |

### Session Timeout

Sessions time out after 1 hour of inactivity. After timeout:

- Task can be resumed by the same session
- Or forced by a different session using `force: true`

### Conflict Detection

Before modifying files, dev-workflow can detect conflicts:

```typescript
check_task_conflicts({
  taskId: "task-uuid",
});
```

Returns warnings about files modified by prior completed tasks in the same plan.

---

## Resuming Tasks

Tasks can be resumed if a session is interrupted.

### When to Resume

- Session timeout or disconnect
- User wants to continue later
- Worker takes over from previous attempt

### How to Resume

1. Call `load_task_session` with the same task ID - it's idempotent
2. Call `get_task_execution_log` to see what was already done
3. Check `git status` for uncommitted changes
4. Continue from where work stopped

```typescript
// Resume existing task
load_task_session({
  taskId: "task-uuid",
  sessionId: "new-session-id",
});

// Read previous progress
get_task_execution_log({
  taskId: "task-uuid",
});
```

### What's Preserved

| Preserved               | Lost                                     |
| ----------------------- | ---------------------------------------- |
| Git worktree and branch | Uncommitted changes (if process crashed) |
| Previous commits        | Claude's memory of context               |
| Execution log entries   | -                                        |
| Task status             | -                                        |

---

## Progress Logging

Progress logs create continuity across sessions.

### When to Log

Log at **milestones only**, not routine operations:

| Task Type | Log Frequency                             |
| --------- | ----------------------------------------- |
| Feature   | 2-4 entries (approach, key milestones)    |
| Bug       | 3-5 entries (hypotheses, root cause, fix) |
| Simple    | 0 entries - just use `finalLogEntry`      |

### How to Log

```typescript
log_task_progress({
  taskId: "task-uuid",
  sessionId: "session-id",
  message: "Implemented OAuth callback handler. Added refresh token logic.",
  filesModified: ["src/auth/callback.ts", "src/auth/tokens.ts"],
});
```

### Good vs Bad Logging

**Good:**

- "Implemented OAuth callback. Added tests."
- "Found root cause: race condition in session refresh."
- "Completed API endpoints, starting frontend."

**Bad:**

- "Reading file X"
- "Running tests"
- "Thinking about approach"

---

## Force Mode

Force mode bypasses state machine validation when state has drifted from reality.

### When State Drifts

- MCP tools were unavailable during a workflow
- PR was merged outside normal flow
- Session timed out but task still marked as owned
- Manual intervention changed state

### Tools with Force Option

| Tool                | What force bypasses           |
| ------------------- | ----------------------------- |
| `create_pr`         | IN_PROGRESS status check      |
| `submit_for_review` | Status and PR existence check |
| `complete_task`     | Status check (wrong status)   |
| `abandon_task`      | Session ownership check       |
| `close_issue`       | Task completion check         |

### Force Mode Protocol

**Never use force without explicit user confirmation.**

1. Tool returns state machine error
2. Analyze actual vs expected state
3. Explain the mismatch to user
4. Ask: "Would you like me to force through this operation?"
5. Only use `force: true` after user confirms

**Example:**

```
Error: Task must be in PR_REVIEW to complete. Current: IN_PROGRESS.

Checking GitHub... PR #42 is merged.

"The task shows IN_PROGRESS but the PR is merged. This happens when
the PR was merged outside the normal flow. Force-complete the task?"

User: "yes" → complete_task({ ..., force: true })
```

---

## Auto-Closing Issues

When `complete_task` is called, the response includes `allTasksComplete`.

| Value   | Meaning                     | Action                                      |
| ------- | --------------------------- | ------------------------------------------- |
| `true`  | All tasks in terminal state | Ask user: "All tasks done. Close issue #N?" |
| `false` | Some tasks remain           | Report completion, suggest next task        |

If user confirms, call `close_issue` to close the parent issue.

---

## Worker-Specific Behavior

Background workers have additional requirements.

### Worker Identification

Workers receive a `workerId` in their prompt. This must be passed to `load_task_session`:

```typescript
load_task_session({
  taskId: "task-uuid",
  sessionId: "worker-session-id",
  workerId: "worker-uuid", // REQUIRED for workers
});
```

### Terminal Action

Workers must call `end_worker_session` as their final action:

```typescript
end_worker_session({
  workerId: "worker-uuid",
  taskId: "task-uuid",
});
```

**Critical:** This is like `process.exit()` - nothing should happen after this call. The worker process terminates immediately.

### Complete Worker Flow

1. Load task with `workerId`
2. Implement the task
3. Create PR and submit for review
4. Wait for PR to merge
5. Call `complete_task`
6. If `allTasksComplete`, optionally close issue
7. Call `end_worker_session` ← **TERMINAL**

See [Background Workers Guide](WORKERS.md) for worker setup and management.

---

## Error Handling

### Common Errors and Solutions

| Error                            | Cause                        | Solution                                               |
| -------------------------------- | ---------------------------- | ------------------------------------------------------ |
| Task not found                   | UUID from summarized session | Use `get_task(issueNumber, taskNumber)` to get real ID |
| Task in progress (other session) | Another session owns task    | Wait, or use force mode if session stale               |
| Create PR failed - no branch     | Worktree not created         | Start task with `load_task_session` first              |
| Submit failed - no PR            | `create_pr` not called       | Create PR first                                        |
| Complete failed - PR not merged  | PR still open                | Merge the PR on GitHub                                 |
| Complete failed - wrong status   | State drift                  | Use force mode after confirming                        |

### MCP Server Connection Issues (rare)

Project resolution is worktree-aware (a session running inside a task worktree
resolves to the parent repo's project), so a worker or worktree session
connecting to the wrong database is now uncommon. As a backstop, if MCP tools
return "not found" errors for data that should exist and the normal recovery
steps don't resolve it:

1. **Stop** - Don't try to work around it
2. Tell user: "The MCP server may be connected to the wrong database. Please restart your Claude session."
3. After restart, resume with `load_task_session` - it's idempotent

**Never** bypass MCP tools with direct database updates or `gh` CLI - this creates inconsistent state.

---

## Summary

| Concept               | Key Points                                                      |
| --------------------- | --------------------------------------------------------------- |
| **Git isolation**     | Worktree + branch for each task                                 |
| **Task lifecycle**    | PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED |
| **PR workflow**       | `create_pr` → `submit_for_review` → merge → `complete_task`     |
| **Session ownership** | One task per session, 1 hour timeout                            |
| **Progress logging**  | Milestones only, enables resume                                 |
| **Force mode**        | Bypasses validation after user confirmation                     |
| **Workers**           | Must use `workerId`, must call `end_worker_session`             |

---
name: dwf-work-task
description: Start working on a task - automatically dispatches to workers if available, otherwise executes inline. Auto-invoked when user wants to "start task", "work on task", "begin task", "pick up task", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:dispatch_task, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_task, mcp:dev-workflow-tracker:move_issue_to_backlog
---

# Work Task Skill

This skill handles the **dispatch decision** when a user wants to start working on a task.

**Flow:**

1. Try to dispatch the task to a worker
2. If dispatch succeeds (workers online) → report success and STOP
3. If no workers available → invoke `dwf-worker-task` skill for inline execution

## When to Invoke

- User mentions: "start task", "work on task", "begin task", "pick up task"
- User wants to work: "let's work on the first task", "start working on #1"
- User is ready: "I'm ready to implement", "let's begin"

## User Communication

**NEVER reference skill names or slash commands to users.** Users interact in natural language.

| ❌ Wrong                      | ✅ Right                                     |
| ----------------------------- | -------------------------------------------- |
| "Use /dwf-work-task to start" | "Would you like to start working on task 1?" |
| "Invoke dwf-worker-task"      | "Starting task locally..."                   |

## Process

### Step 1: Identify the Task

1. **If user specified a task** → use that task ID/number
2. **If not specified** → call `list_available_tasks` and help user choose
3. **If only one task available** → confirm and proceed

### Step 2: Check Task Status

- **If task is PLANNED:** The plan hasn't been approved yet.
  - Ask the user: "This task is still planned. Are you satisfied with the plan? Ready to start working on it?"
  - If user confirms → call `move_issue_to_backlog` to make tasks available
  - This transitions all PLANNED tasks to BACKLOG and creates GitHub issues (unless user requests `skipGitHubSync: true`)
- **If task is BACKLOG or READY:** Proceed with dispatch attempt

### Step 3: Try Dispatch to Worker

Call `dispatch_task` with the task ID.

**If dispatch succeeds:**

```
Task dispatched to worker queue. A worker will pick it up shortly.

You can check on the task status later or work on something else.
```

**STOP HERE** - do not continue to execution. The worker will handle it.

**If dispatch fails (no workers online):**

Proceed to Step 4.

### Step 4: Execute Inline via dwf-worker-task

If no workers are available, invoke the `dwf-worker-task` skill to execute the task locally.

Use the Skill tool: `skill: "dwf-worker-task", args: "start task #N"`

This passes control to the worker-task skill which handles:

- Loading the task session
- Implementation
- PR creation
- Task completion

## Key Points

- **This skill does NOT execute tasks** - it only decides where they run
- **Workers get tasks via dispatch queue** - they use `dwf-worker-task` directly
- **Inline execution uses `dwf-worker-task`** - no duplication of execution logic
- **Dispatch is attempted first** - workers are preferred when available

## Example Interactions

### Task Dispatched to Worker

**User:** "Start working on task 1"

```
Checking for available workers...

Task dispatched to worker queue. A worker will pick it up shortly.

You can check on the task status later or work on something else.
```

### No Workers - Inline Execution

**User:** "Start working on task 1"

```
Checking for available workers...
No workers online. Starting task locally...

[Control passes to dwf-worker-task]

Starting task session in isolated mode...

Task: Add OAuth2 authentication with Google provider
Branch: issue-5/task-1-add-oauth
Worktree: ~/.track/project-abc/worktrees/issue-5-task-1

Acceptance Criteria:
- [ ] OAuth callback processes Google auth correctly
- [ ] Access tokens securely stored
- [ ] Unit tests achieve 80%+ coverage

Task is now IN_PROGRESS. Ready to begin?
```

## Notes

- Workers use `dwf-worker-task` directly - they never go through this dispatch skill
- This separation makes it impossible for workers to accidentally re-dispatch
- All execution logic lives in `dwf-worker-task` - this skill is just a router

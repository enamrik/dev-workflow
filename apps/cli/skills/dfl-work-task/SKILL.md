---
name: dfl-work-task
description: Start working on a task - automatically dispatches to workers if available, otherwise executes inline. Auto-invoked when user wants to "start task", "work on task", "begin task", "pick up task", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:dispatch_task, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_task, mcp:dev-workflow-tracker:move_issue_to_backlog
---

# Work Task Skill

This skill handles the **dispatch decision** when a user wants to start working on a task.

**Flow:**

1. Check for inline execution hints → if present, skip dispatch
2. Try to dispatch the task to a worker
3. If dispatch succeeds (workers online) → report success and STOP
4. If no workers available → invoke `dfl-worker-task` skill for inline execution

## When to Invoke

- User mentions: "start task", "work on task", "begin task", "pick up task"
- User wants to work: "let's work on the first task", "start working on #1"
- User is ready: "I'm ready to implement", "let's begin"

## User Communication

**NEVER reference skill names or slash commands to users.** Users interact in natural language.

| ❌ Wrong                      | ✅ Right                                     |
| ----------------------------- | -------------------------------------------- |
| "Use /dfl-work-task to start" | "Would you like to start working on task 1?" |
| "Invoke dfl-worker-task"      | "Starting task locally..."                   |

## Inline Execution Hints

Users can bypass worker dispatch by using keywords that indicate they want the task to run locally:

**Inline execution keywords:**

- "run inline", "inline"
- "run here", "here"
- "run locally", "locally"
- "run in this session", "in this session"
- "don't dispatch", "no dispatch"
- "work on it myself", "I'll work on it"

**Example:** "start task 1 inline" or "work on the task here" → skip dispatch, execute locally

When you detect these hints, skip the dispatch attempt entirely and go straight to `dfl-worker-task`.

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

### Step 3: Check for Inline Execution Hints

Before attempting dispatch, check if the user's request contains inline execution hints (see list above).

**If inline hints detected:** Skip dispatch entirely → proceed to Step 5 (inline execution)

**If no inline hints:** Proceed to Step 4 (dispatch attempt)

### Step 4: Try Dispatch to Worker

Call `dispatch_task` with the task ID.

#### ⚠️ CRITICAL: Dispatch Success = You Are DONE

**Once `dispatch_task` returns `success: true`, your job is COMPLETE.**

- Do NOT continue to execute the task
- Do NOT invoke `dfl-worker-task`
- Do NOT check on the task or wait for it
- The task is now in the queue - a worker will handle it (or the user will run one later)

This applies **regardless of**:

- Whether workers are currently online (`workerSummary.total` may be 0)
- Whether the task was already queued (`alreadyQueued: true`)
- Whether a worker has claimed it yet (`claimedByWorker` may be null)

#### Interpreting dispatch_task Response

The response includes:

| Field               | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `success`           | Task is in the queue - **you are done**            |
| `alreadyQueued`     | Task was already in queue (idempotent)             |
| `queueEntry.status` | PENDING (unclaimed) or CLAIMED                     |
| `claimedByWorker`   | Worker that claimed the task (if any)              |
| `workerSummary`     | Live worker counts: total, idle, working, draining |

#### Reporting to User

Use `workerSummary` for accurate feedback, then **ask the user what they want to do next**:

```
// workerSummary.idle > 0
Task dispatched. 2 idle workers available to pick it up.

What would you like to do next?

// workerSummary.total == 0
Task queued. No workers are currently online.

Would you like to:
- Start a worker with `./scripts/start-worker.sh`
- Work on something else
- Run this task inline instead?

// claimedByWorker is set
Task was already claimed by worker "worker-abc" and is being worked on.

What would you like to do next?

// alreadyQueued && queueEntry.isStale
Task is queued but the claiming worker may be stale.

Would you like to:
- Check worker status with `get_dispatch_status`
- Start a fresh worker
- Work on something else?
```

**After reporting, wait for user direction.** Do not proceed to inline execution on your own.

#### When to Execute Inline

Only execute inline (Step 5) when:

1. User explicitly requested inline execution (keywords like "run here", "inline", "locally")
2. `dispatch_task` returns an **error** (task not found, invalid status, etc.)
3. User responds to your prompt asking to "run inline" after dispatch succeeded

**A successful dispatch with zero online workers is NOT a reason to execute inline.** The task is queued and will be picked up when workers come online. Report the status and ask the user what they want to do.

### Step 5: Execute Inline via dfl-worker-task

Execute inline when the user has explicitly requested it (either upfront or after dispatch).

Use the Skill tool: `skill: "dfl-worker-task", args: "start task #N"`

This passes control to the worker-task skill which handles:

- Loading the task session
- Implementation
- PR creation
- Task completion

## Key Points

- **This skill does NOT execute tasks** - it only decides where they run
- **Workers get tasks via dispatch queue** - they use `dfl-worker-task` directly
- **Inline execution uses `dfl-worker-task`** - no duplication of execution logic
- **Dispatch is attempted first** - workers are preferred when available
- **NEVER pass `workerId` to `load_task_session`** - only workers pass workerId (they receive it in their prompt). This skill runs for users, not workers.

## Example Interactions

### Task Dispatched - Workers Available

**User:** "Start working on task 1"

```
Task dispatched. 2 idle workers available to pick it up.

What would you like to do next?
```

### Task Dispatched - No Workers Online

**User:** "Start working on task 1"

```
Task queued. No workers are currently online.

Would you like to:
- Start a worker with `./scripts/start-worker.sh`
- Work on something else
- Run this task inline instead?
```

**User:** "Run it inline"

```
Starting task locally...

[Control passes to dfl-worker-task]
```

### Task Already Being Worked On

**User:** "Start working on task 1"

```
Task was already claimed by worker "worker-abc" and is being worked on.

What would you like to do next?
```

### User Requests Inline Execution Upfront

**User:** "Start task 1 inline" or "Work on the task here"

```
Starting task locally (inline execution requested)...

[Control passes to dfl-worker-task]
```

## Notes

- Workers use `dfl-worker-task` directly - they never go through this dispatch skill
- This separation makes it impossible for workers to accidentally re-dispatch
- All execution logic lives in `dfl-worker-task` - this skill is just a router

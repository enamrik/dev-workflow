---
name: dfl-work-task
description: Start working on a task - marks it READY so a running worker auto-claims it, or executes inline on request. Auto-invoked when user wants to "start task", "work on task", "begin task", "pick up task", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:move_issue_to_ready, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_task, mcp:dev-workflow-tracker:current_project, mcp:dev-workflow-tracker:select_project, mcp:dev-workflow-tracker:list_projects
---

# Work Task Skill

This skill **starts work** on a task. There is exactly ONE way to start work: mark the
task **READY** via `move_issue_to_ready`. A running worker auto-claims any READY task
once its dependencies are satisfied — you do not enqueue or dispatch anything yourself.

**Flow:**

1. Check for inline execution hints → if present, skip the worker path and run inline
2. If the task is still PLANNED → move it to backlog first
3. Mark the task READY (`move_issue_to_ready`) → a running worker auto-claims it
4. Report and STOP

## Active Project Guard (CRITICAL)

**Before dispatching or starting a task, confirm you're targeting the right project.** The MCP server can be pointed at a project that differs from the folder you're in.

1. Call `current_project`. If `mismatch === true`, the active project differs from your current folder.
2. When mismatched, CONFIRM with the user first: "You're in <cwd.name> but the active project is <active.name> — start this task in <active.name>?"
3. To switch projects, call `select_project({ slug })` (use `list_projects` to find the slug).

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

Users can run the task locally in this session instead of leaving it for a worker:

**Inline execution keywords:**

- "run inline", "inline"
- "run here", "here"
- "run locally", "locally"
- "run in this session", "in this session"
- "work on it myself", "I'll work on it"

**Example:** "start task 1 inline" or "work on the task here" → skip the worker path, execute locally.

When you detect these hints, skip marking the task READY and go straight to `dfl-worker-task`.

## Process

### Step 1: Identify the Task

1. **If user specified a task** → use that task ID/number
2. **If not specified** → call `list_available_tasks` and help user choose
3. **If only one task available** → confirm and proceed

### Step 2: Check Task Status

- **If task is PLANNED:** The plan hasn't been approved yet.
  - Ask: "This task is still planned. Are you satisfied with the plan? Ready to start working on it?"
  - If user confirms → call `move_issue_to_backlog` (transitions all PLANNED tasks to BACKLOG and creates GitHub issues unless `skipGitHubSync: true` is requested), then proceed to Step 4.
- **If task is BACKLOG:** Proceed to Step 3.
- **If task is already READY:** It is already eligible — a running worker will auto-claim it once dependencies are satisfied. Report that and STOP.

### Step 3: Check for Inline Execution Hints

Before marking the task READY, check if the user's request contains inline execution hints (see list above).

- **If inline hints detected:** Skip the worker path → proceed to Step 5 (inline execution)
- **If no inline hints:** Proceed to Step 4

### Step 4: Mark the Task READY

Call `move_issue_to_ready` with the issue number.

Once it succeeds, **your job is COMPLETE.** The task is now READY:

- Do NOT continue to execute the task
- Do NOT invoke `dfl-worker-task`
- Do NOT check on the task or wait for it

A running worker auto-claims the task once all prerequisite tasks are COMPLETED or
ABANDONED. If no worker is running, the task simply stays READY until one starts.

#### Reporting to User

```
Task marked ready. A running worker will pick it up once its dependencies are satisfied.

If no worker is running, start one with `./scripts/start-worker.sh` — or I can run this task here instead.

What would you like to do next?
```

**After reporting, wait for user direction.** Do not proceed to inline execution on your own.

#### When to Execute Inline

Only execute inline (Step 5) when:

1. User explicitly requested inline execution (keywords like "run here", "inline", "locally")
2. User responds to your prompt asking to run it here after the task was marked READY

### Step 5: Execute Inline via dfl-worker-task

Execute inline when the user has explicitly requested it (either upfront or afterward).

Use the Skill tool: `skill: "dfl-worker-task", args: "start task #N"`

This passes control to the worker-task skill which handles:

- Loading the task session
- Implementation
- PR creation
- Task completion

## Key Points

- **This skill does NOT execute tasks** — it marks them READY (or hands off to inline execution)
- **READY is the single way to start work** — a running worker auto-claims READY, dependency-satisfied tasks
- **Inline execution uses `dfl-worker-task`** — no duplication of execution logic
- **NEVER pass `workerId` to `load_task_session`** — only workers pass workerId (they receive it in their prompt). This skill runs for users, not workers.

## Example Interactions

### Task Marked Ready

**User:** "Start working on task 1"

```
Task marked ready. A running worker will pick it up once its dependencies are satisfied.

If no worker is running, start one with `./scripts/start-worker.sh` — or I can run this task here instead.

What would you like to do next?
```

### User Requests Inline Execution Upfront

**User:** "Start task 1 inline" or "Work on the task here"

```
Starting task locally (inline execution requested)...

[Control passes to dfl-worker-task]
```

### User Requests Inline After Marking Ready

**User:** "Run it inline"

```
Starting task locally...

[Control passes to dfl-worker-task]
```

## Notes

- Workers use `dfl-worker-task` directly — they never go through this skill
- This separation makes it impossible for workers to accidentally re-trigger work routing
- All execution logic lives in `dfl-worker-task` — this skill is just a router

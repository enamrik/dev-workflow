---
sidebar_position: 2
---

# Background Workers

Background workers are Claude instances that automatically poll for and execute dispatched tasks.

## Overview

```
┌─────────────────┐     dispatch_task()     ┌─────────────────┐
│   Main Claude   │ ───────────────────────▶│  Dispatch Queue │
│    Session      │                         └────────┬────────┘
└─────────────────┘                                  │
                                                     │ poll
                                                     ▼
                    ┌──────────────────────────────────────────┐
                    │              Worker Pool                  │
                    │  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
                    │  │Worker 1 │  │Worker 2 │  │Worker 3 │   │
                    │  └─────────┘  └─────────┘  └─────────┘   │
                    └──────────────────────────────────────────┘
```

## Starting Workers

### Command

```bash
dfl claude --name worker-1
```

### Options

| Option          | Description                                  |
| --------------- | -------------------------------------------- |
| `--name <name>` | Worker name (auto-generated if not provided) |
| `--auto-claim`  | Automatically claim READY tasks              |

### Multiple Workers

Run multiple workers for parallel execution:

```bash
# Terminal 1
dfl claude --name worker-1

# Terminal 2
dfl claude --name worker-2

# Terminal 3
dfl claude --name worker-3
```

## Dispatching Tasks

### From Main Session

```typescript
dispatch_task({
  taskId: "task-uuid",
});
```

### What Happens

1. Task is added to dispatch queue
2. Workers poll the queue
3. First available worker claims the task
4. Worker executes task via `dfl-worker-task` skill
5. Worker signals completion

## Worker Lifecycle

### States

| State    | Description                            |
| -------- | -------------------------------------- |
| IDLE     | Polling for tasks                      |
| WORKING  | Executing a task                       |
| DRAINING | Completing current task, then stopping |

### Execution Flow

```
1. Worker starts, registers in database
2. Poll dispatch queue every few seconds
3. Claim available task
4. Resolve the task's owning project from the task record (not the queue slug)
5. Pre-create (or adopt) the task's git worktree
6. Spawn Claude session inside that worktree (cwd = worktree) with dfl-worker-task
7. Wait for session completion
8. Return to polling
```

The worker creates the worktree **before** spawning, so the Claude session
starts already standing in it. `load_task_session` then adopts the existing
worktree (it only creates one as a fallback for inline execution) and returns
its path.

## Worker-Specific Requirements

### Worker ID

Workers receive a `workerId` that must be passed to `load_task_session`:

```typescript
load_task_session({
  taskId: "task-uuid",
  sessionId: "session-id",
  workerId: "worker-uuid", // REQUIRED
  mode: "isolated", // Always isolated for workers
});
```

### Terminal Action

Workers MUST call `end_worker_session` as final action:

```typescript
end_worker_session({
  workerId: "worker-uuid",
  taskId: "task-uuid",
});
```

:::danger Critical
`end_worker_session` is like `process.exit()`. Nothing should happen after this call.
:::

## Complete Worker Flow

```
1. load_task_session with workerId
2. Implement the task
3. create_pr
4. submit_for_review
5. Wait for PR to merge
6. complete_task
7. If allTasksComplete, optionally close_issue
8. end_worker_session  ← TERMINAL
```

## Monitoring Workers

### Check Status

```bash
dfl workers
```

Or via MCP:

```typescript
get_dispatch_status({});
```

### Output

```
Workers:
  worker-1: IDLE (alive)
  worker-2: WORKING on task abc-123
  worker-3: IDLE (alive)

Queue:
  task-def-456: pending
  task-ghi-789: pending

Stats:
  Total: 2
  Unclaimed: 2
  Claimed: 0
```

## Auto-Claim Mode

With `--auto-claim`, workers automatically claim READY tasks when dependencies complete:

```bash
dfl claude --name worker-1 --auto-claim
```

This enables fully autonomous task execution across dependency chains.

## Error Handling

### Task Failure

If a worker fails during execution:

1. Task remains IN_PROGRESS
2. Session times out (1 hour)
3. Another worker can claim with force mode

### Worker Crash

If a worker process crashes:

1. Worker shows as not alive
2. Claimed tasks can be reclaimed
3. Restart worker to resume

### Stale Workers

Clean up stale worker entries:

```typescript
// Workers auto-cleanup on timeout
// Or manually via database
```

## Best Practices

### Worker Count

| Project Size | Recommended Workers |
| ------------ | ------------------- |
| Small        | 1-2                 |
| Medium       | 2-4                 |
| Large        | 4-8                 |

### Resource Usage

Each worker:

- Spawns Claude CLI process
- Creates git worktree
- Uses API tokens

Plan capacity accordingly.

### Monitoring

- Watch worker output for errors
- Check dispatch status regularly
- Set up alerts for stuck tasks

## Example: Full Worker Setup

```bash
# Terminal 1: Main development
cd my-project
claude

# In Claude:
> "Create feature for user authentication"
> "Plan issue #5"
> "Yes, approve the plan"
> "Dispatch task #5.1"
> "Dispatch task #5.2"
> "Dispatch task #5.3"

# Terminal 2-4: Workers
dfl claude --name worker-1 --auto-claim
dfl claude --name worker-2 --auto-claim
dfl claude --name worker-3 --auto-claim

# Workers automatically:
# - Pick up dispatched tasks
# - Execute in parallel (respecting dependencies)
# - Create PRs
# - Complete when merged
```

## Troubleshooting

### Worker Not Picking Up Tasks

1. Check worker is running: `dfl workers`
2. Check task is in queue: `get_dispatch_status()`
3. Verify task status is READY or BACKLOG

### Worker Stuck

1. Check Claude session output
2. Look for MCP server errors
3. Force-abandon task if needed

### Too Many Workers

If workers compete for same tasks:

- Reduce worker count
- Use auto-claim strategically
- Sequence dependent tasks

## Next Steps

- [Troubleshooting Guide](/advanced/troubleshooting)
- [Contributing](/advanced/contributing)

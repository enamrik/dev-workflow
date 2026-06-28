# Background Workers

> This guide is part of the [dev-workflow documentation](../README.md).

Workers are background Claude Code processes that automatically pick up and execute tasks from a dispatch queue. This enables parallel task execution across multiple terminal sessions.

## Overview

### How Workers Work

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dispatch Queue                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│  │ Task A   │  │ Task B   │  │ Task C   │  ...                  │
│  │ PENDING  │  │ PENDING  │  │ WORKING  │                       │
│  └──────────┘  └──────────┘  └──────────┘                       │
└──────────────────┬─────────────────┬────────────────────────────┘
                   │                 │
              claims             claimed by
                   │                 │
                   ▼                 ▼
            ┌─────────────┐   ┌─────────────┐
            │  Worker 1   │   │  Worker 2   │
            │    IDLE     │   │   WORKING   │
            │  (polling)  │   │  (Claude)   │
            └─────────────┘   └─────────────┘
```

1. **You mark a task READY** via `move_issue_to_ready` or the `dfl-work-task` skill
2. **Workers poll** for READY tasks whose dependencies are satisfied
3. **Worker claims** a task atomically (prevents double-claiming)
4. **Worker spawns Claude** to execute the task
5. **Claude completes** the task lifecycle (implement → PR → merge)
6. **Claude calls `end_worker_session`** to signal completion
7. **Worker terminates Claude** and returns to polling

### Key Concepts

| Concept            | Description                                      |
| ------------------ | ------------------------------------------------ |
| **Dispatch Queue** | Database table holding tasks waiting for workers |
| **Worker**         | A `dfl worker` process running in a terminal     |
| **Claim**          | Atomic lock that assigns a task to one worker    |
| **Heartbeat**      | Periodic signal that a worker is still alive     |
| **Stale**          | A claim from a dead worker (heartbeat expired)   |

## Starting a Worker

Run in a dedicated terminal:

```bash
dfl worker
```

The worker will:

1. Register itself with a unique ID and name (e.g., `worker-1`)
2. Start sending heartbeats every 5 seconds
3. Poll for tasks every 2 seconds
4. Display status in terminal title

### Worker Options

```bash
dfl worker --name my-worker  # Custom name
```

### Recommended Setup

Open multiple terminal windows/tabs or use tmux:

```bash
# Terminal 1
dfl worker --name worker-1

# Terminal 2
dfl worker --name worker-2

# Terminal 3 (your main session)
# Dispatch tasks, the workers will pick them up
```

## Dispatching Tasks

### Using the Skill

The `dfl-work-task` skill marks the task READY so a running worker can pick it up:

```
"Start task #5.2"
```

Claude will:

1. If the task is still PLANNED → move it to backlog first
2. Mark the task READY (`move_issue_to_ready`)
3. A running worker auto-claims it once dependencies are satisfied (or, if inline
   execution was requested, run it here via `dfl-worker-task`)

### Marking a Task Ready

Use the MCP tool directly:

```
move_issue_to_ready(issueNumber: N)
```

Requirements:

- The task must already be in BACKLOG (PLANNED tasks must first be moved to backlog)
- A worker auto-claims the task only after all prerequisite tasks are COMPLETED or ABANDONED

## Worker Lifecycle

### States

| State    | Description                          |
| -------- | ------------------------------------ |
| IDLE     | Polling for tasks, no current work   |
| WORKING  | Actively executing a task via Claude |
| DRAINING | Graceful shutdown in progress        |

### Lifecycle Flow

```
START
  │
  ▼
┌─────┐
│IDLE │◄──────────────────────────────────┐
└──┬──┘                                   │
   │ claims task                          │
   ▼                                      │
┌───────┐                                 │
│WORKING│                                 │
└───┬───┘                                 │
    │ task complete                       │
    │ OR task abandoned                   │
    ▼                                     │
end_worker_session() ─────────────────────┘
    │
    ▼ (if SIGINT/SIGTERM during WORKING)
┌────────┐
│DRAINING│ (finishes current task then exits)
└────────┘
```

### Heartbeats

Workers send heartbeats every 5 seconds. If a worker dies:

- Its heartbeat becomes stale (>10 seconds old)
- Other workers can reclaim its task
- Dead workers are cleaned up automatically

## The `end_worker_session` Tool

This is the **terminal action** for worker task execution. Think of it like `process.exit()`.

### When to Call

After `complete_task` or `abandon_task`:

```
complete_task(taskId: "...", sessionId: "...", finalLogEntry: "...")
// Task is now COMPLETED

end_worker_session(workerId: "worker-uuid", taskId: "...")
// Worker terminates Claude, returns to polling
```

### What It Does

1. Sets `claudeDone` flag on dispatch queue entry
2. Worker detects flag and terminates Claude session
3. Worker removes task from queue
4. Worker returns to IDLE and resumes polling

### Critical Rules

1. **Nothing happens after `end_worker_session`** - The worker terminates the Claude process
2. **Always call it** - If you don't, worker waits 30s then times out
3. **Worker ID required** - Must match the worker that claimed the task

### Example Worker Session

```
[Worker spawns Claude with prompt including workerId]

Claude: Loading task #5.2...
Claude: [implements task]
Claude: Creating PR...
Claude: Submitting for review...

[User merges PR on GitHub]

Claude: PR merged! Completing task...
Claude: complete_task(..., finalLogEntry: "Implemented OAuth flow...")
Claude: end_worker_session(workerId: "abc-123", taskId: "...")

[Worker detects claudeDone flag]
[Worker terminates Claude]
[Worker returns to polling]
```

## Monitoring Workers

### Web UI

The Workers page shows:

- Active workers with status
- Current task for each worker
- Heartbeat age (freshness)
- Dispatch queue contents

Access via: `dfl ui` → Workers tab

### Terminal Title

Each worker displays its status in the terminal title:

| Title                                       | Meaning                  |
| ------------------------------------------- | ------------------------ |
| `worker-1 \| polling...`                    | Idle, looking for tasks  |
| `worker-1 \| #5.2 Add OAuth \| IN_PROGRESS` | Working on task          |
| `worker-1 \| draining...`                   | Shutting down gracefully |

### Programmatic

Use MCP tools:

```
get_work_queue()  // Shows queue and worker status
```

## Queue States

### Entry Status

| Status  | Description                                |
| ------- | ------------------------------------------ |
| PENDING | In queue, waiting to be claimed            |
| WORKING | Claimed by a worker, execution in progress |

### Staleness

A WORKING entry becomes **stale** if the worker's heartbeat is too old:

- Heartbeat threshold: 10 seconds
- Stale claims can be reclaimed by other workers
- Prevents stuck tasks from dead workers

## Error Handling

### Worker Dies Mid-Task

1. Task remains in queue as WORKING
2. Heartbeat becomes stale
3. Another worker can reclaim it
4. New worker calls `load_task_session` (idempotent)
5. Session resumes from where it left off

### Claude Session Fails

If Claude crashes or times out:

1. Worker detects process exit
2. Task remains in queue (not removed)
3. Worker returns to polling
4. Another worker can reclaim the stale task

### Task State Recovery

The `load_task_session` tool is idempotent:

- If task is already IN_PROGRESS, resumes existing session
- Use `get_task_execution_log` to see previous progress
- Worktree and branch persist between sessions

### Timeout Fallback

If Claude finishes but forgets to call `end_worker_session`:

1. Worker detects task in terminal state (COMPLETED/ABANDONED)
2. Waits 30 seconds for `end_worker_session` call
3. If timeout expires, terminates Claude anyway
4. Logs warning about missing `end_worker_session`

## Graceful Shutdown

Send SIGINT (Ctrl+C) or SIGTERM to a worker:

1. Worker stops polling for new tasks
2. If working on a task:
   - Status → DRAINING
   - Waits for Claude to finish current task
   - Claude should complete normally and call `end_worker_session`
3. Worker unregisters and exits

## Best Practices

### Scaling

- **2-3 workers** is typically sufficient for most projects
- Each worker needs its own terminal
- Workers share the same database - no configuration needed

### Terminal Management

- Use **tmux** or **screen** for persistent workers
- Workers survive terminal disconnects in tmux
- Terminal title shows current status at a glance

### Task Sizing

- Workers work best with **focused tasks** (1-3 hours of work)
- Large tasks can block a worker for extended periods
- Break large features into multiple tasks

### Monitoring

- Check Web UI periodically for stuck tasks
- Watch for stale heartbeats indicating dead workers
- Run `sync_issue` if GitHub sync state drifts

## Troubleshooting

### Worker Not Picking Up Tasks

1. Check worker is in IDLE state (terminal title)
2. Verify task is in queue: `get_work_queue()`
3. Ensure task status is BACKLOG or READY
4. Check for stale claims blocking the task

### Task Stuck in WORKING

1. Check if claiming worker is alive (heartbeat)
2. If worker is dead, wait for staleness timeout
3. Or restart workers to reclaim stale tasks

### Claude Not Completing

1. Check Claude session in worker terminal
2. Look for errors or prompts waiting for input
3. Claude may be waiting for PR merge
4. Check task status in Web UI

### Multiple Workers Claiming Same Task

This shouldn't happen - claims are atomic. If it does:

1. Check database integrity
2. Restart all workers
3. Only one session should be active per task

## Related

- [Task Execution](TASK_EXECUTION.md) - Task lifecycle and modes
- [GitHub Integration](GITHUB_INTEGRATION.md) - GitHub sync for tasks
- [MCP Tools Reference](MCP_TOOLS.md) - Complete tool documentation

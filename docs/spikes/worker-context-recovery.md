# Spike: Worker Context Recovery Strategies

**Issue**: #191
**Date**: 2026-01-10
**Status**: Complete

## Problem Statement

Workers tend to compact conversations, lose context, and hallucinate during long sessions. When this happens, Claude may forget critical information:

- **`workerId`** and **`taskId`** (UUIDs) - but usually remembers simple integers like `taskNumber` and `issueNumber`
- **Worktree directory path** - Claude may lose track of which directory it should be working in

This is problematic because:
1. `end_worker_session(workerId, taskId)` requires both UUIDs
2. `complete_task`, `create_pr`, and other tools need `taskId`
3. If Claude hallucinates these values, operations fail or corrupt state
4. If Claude loses the worktree path, it may execute commands in the wrong directory

## Current State Analysis

### What's Already Available

1. **`get_task(issueNumber, taskNumber)`** - Returns task data including:
   - `id` (taskId UUID)
   - `workerInfo.workerId` and `workerInfo.sessionId` (when task is IN_PROGRESS)
   - But does NOT return `worktreePath` or `branchName`

2. **`load_task_session`** returns:
   - Full task context including `worktreePath` and `branchName`
   - But this is designed to START sessions, not recover context

3. **Task schema stores** `worktreePath` and `branchName` columns in the database

4. **`list_worktrees`** - Lists all git worktrees with paths
   - Worktree names follow pattern: `issue-N-task-M`
   - Could be used to locate the correct worktree

5. **Dispatch queue stores** `workerId` when a task is claimed by a worker

### What Triggers Context Loss?

1. **Conversation compaction** - When context exceeds certain thresholds, the model summarizes earlier messages
2. **Long-running tasks** - More tool calls = more opportunities for compaction
3. **Many tool calls** - File reads, edits, and bash commands consume context
4. **Session duration** - Extended sessions increase compaction probability

### What Gets Lost vs. Preserved

| Information | Likely Preserved | Likely Lost |
|-------------|------------------|-------------|
| Task number (e.g., "task 2") | ✓ | |
| Issue number (e.g., "#191") | ✓ | |
| Task UUID | | ✓ |
| Worker UUID | | ✓ |
| Worktree path | | ✓ |
| General task description | ✓ | |
| Specific file paths | | ✓ |

## Recovery Options Evaluated

### Option 1: Recovery Tool (`recover_worker_context`)

**Description**: Add a new MCP tool that accepts simple identifiers and returns all context.

```typescript
recover_worker_context({
  issueNumber: 191,
  taskNumber: 2
}) → {
  taskId: "de9d22cf-...",
  workerId: "d8328ab2-...",  // from dispatch queue
  worktreePath: "/Users/.../.track/.../worktrees/issue-191-task-2",
  branchName: "issue-191/task-2-spike-explore-worker-context-r",
  sessionId: "..."
}
```

**Pros**:
- Single tool call for full context recovery
- Can validate that task is still IN_PROGRESS
- Can validate that worker matches dispatch queue entry
- Centralizes recovery logic

**Cons**:
- New tool to implement and maintain
- Claude must remember to call it when uncertain
- Adds to the already large tool surface

### Option 2: Enhance `get_task` to Return Full Context

**Description**: Modify `get_task` to also return `worktreePath` and `branchName` when task has them.

```typescript
get_task({
  issueNumber: 191,
  taskNumber: 2
}) → {
  id: "de9d22cf-...",
  worktreePath: "/Users/.../.track/.../worktrees/issue-191-task-2",  // NEW
  branchName: "issue-191/task-2-...",  // NEW
  workerInfo: {
    workerId: "d8328ab2-...",
    sessionId: "..."
  },
  ...
}
```

**Pros**:
- Minimal change - just add fields to existing tool response
- `get_task` already exists and returns worker info
- Skill already teaches Claude to use `get_task(issueNumber, taskNumber)` for recovery
- No new tool to learn

**Cons**:
- Doesn't provide workerId directly (though it's in `workerInfo`)
- Requires Claude to know that `get_task` is the recovery mechanism

### Option 3: Skill-Based Recovery (Current Approach)

**Description**: The skill already teaches Claude recovery procedures:

```markdown
### Session Continuation Recovery (IMPORTANT)

**Task UUIDs from summarized sessions may be hallucinated.** If you get `Task not found`:

1. Use **issue/task numbers from context** (simple integers, reliable)
2. Call `get_task(issueNumber: N, taskNumber: M)` → returns real task ID

**Never** use task UUIDs from summaries - always fetch by issue/task number.
```

**Pros**:
- Already implemented
- No code changes required
- Teaches Claude good practices

**Cons**:
- Doesn't explicitly cover worktree path recovery
- Relies on Claude reading and following skill instructions
- Multiple tool calls may be needed (get_task + list_worktrees for worktree path)

### Option 4: Persistent Storage (File in Worktree)

**Description**: Create a `.worker-context.json` file in the worktree when session starts.

```json
{
  "workerId": "d8328ab2-...",
  "taskId": "de9d22cf-...",
  "issueNumber": 191,
  "taskNumber": 2,
  "worktreePath": "/Users/.../.track/.../worktrees/issue-191-task-2",
  "branchName": "issue-191/task-2-...",
  "startedAt": "2026-01-10T05:28:28.308Z"
}
```

**Pros**:
- Context survives conversation compaction entirely
- Simple file read to recover all context
- File location is predictable (always in worktree root)
- Works even if Claude forgets everything

**Cons**:
- Requires Claude to know the worktree path to read the file (chicken-and-egg)
- File could be accidentally committed
- Need to add to .gitignore
- Extra file management complexity

### Option 5: Context Anchor in Skill

**Description**: Add a "Context Anchor" section to the skill that Claude is trained to preserve:

```markdown
## Context Anchor (PRESERVE THIS)

When you start a task, immediately record these values:
- WORKER_ID: <from prompt>
- TASK_ID: <from load_task_session>
- WORKTREE_PATH: <from load_task_session>

If you become uncertain about any value, re-read this section before proceeding.
```

**Pros**:
- Encourages Claude to maintain critical context
- No code changes needed
- Skill can be updated easily

**Cons**:
- Relies on Claude behavior which may not be consistent
- May still be lost in aggressive compaction
- Doesn't help if Claude forgot it was even a worker

### Option 6: Environment Variables

**Description**: Set environment variables when worker spawns Claude.

```bash
export DWF_WORKER_ID="d8328ab2-..."
export DWF_WORKTREE_PATH="/Users/.../.track/.../worktrees/issue-191-task-2"
```

**Pros**:
- Truly persistent - survives all compaction
- Can be checked via bash tool
- Set once at worker start

**Cons**:
- Claude would need to know to check environment
- Not visible in Claude's normal context
- Requires bash command to read
- Worker process already passes workerId in prompt

## Recommended Approach

**Primary: Option 2 - Enhance `get_task` to return worktree info**

This is the minimal, highest-impact change:

1. `get_task` already returns `workerInfo` with `workerId` and `sessionId`
2. Adding `worktreePath` and `branchName` to the response requires minimal code
3. The skill already teaches Claude to use `get_task(issueNumber, taskNumber)` for recovery
4. Claude reliably remembers issue/task numbers even after compaction

**Implementation**:
- Modify `handleGetTask` to include `worktreePath` and `branchName` in the response
- Update `EnrichedTaskData` interface to include these fields
- The data is already in the task record, just not being returned

**Secondary: Update skill documentation**

Add explicit recovery guidance for worktree path:

```markdown
### Recovering Context After Compaction

If you've lost track of UUIDs or paths:

1. Call `get_task(issueNumber: N, taskNumber: M)`
2. This returns:
   - `id` (taskId)
   - `workerInfo.workerId`
   - `worktreePath`
   - `branchName`
3. Use these values for all subsequent operations
```

## Follow-up Issues

1. **Enhance `get_task` to return `worktreePath` and `branchName`** (RECOMMENDED)
   - Type: ENHANCEMENT
   - Priority: MEDIUM
   - Estimated complexity: LOW

2. **Update skill documentation for comprehensive context recovery** (OPTIONAL)
   - Type: TASK
   - Priority: LOW
   - Can be done as part of the enhancement

## Conclusion

The worker context recovery problem is largely solved by **existing capabilities**, with one small gap: `get_task` doesn't return `worktreePath` and `branchName`. Adding these fields to the existing tool response is the simplest, most effective solution.

The skill already documents the recovery pattern (`get_task(issueNumber, taskNumber)`). Once `get_task` returns the full context including worktree info, Claude will have everything needed to recover from context loss with a single tool call.

No new tools or complex recovery mechanisms are needed.

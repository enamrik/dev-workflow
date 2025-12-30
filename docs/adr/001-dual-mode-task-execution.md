# ADR-001: Dual-Mode Task Execution

## Status

Accepted

## Context

Tasks need to be executed by Claude sessions. We identified two conflicting user needs:

1. **Full visibility**: Users want to see every step, file edit, and decision as the task executes
2. **Parallel execution**: Users want multiple tasks running simultaneously with isolated context budgets

These needs conflict because:
- Real-time visibility requires execution in the current session
- Parallel execution requires spawning subagents (which don't stream intermediate steps)

## Decision

Support **both modes** and let the user choose based on their needs.

### Inline Mode (Full Visibility)

Task executes directly in the current Claude session.

**Characteristics:**
- User sees every tool call, file edit, and reasoning step
- Single task at a time
- Shares context budget with main conversation

**Flow:**
```
Main Session
     │
     │ start_task_session(taskId)
     │ [execute task - user sees everything]
     │ complete_task_session(taskId)
```

**Triggered by:** "start task", "work on task", "let's implement"

### Subagent Mode (Parallel/Isolated)

Task executes in a spawned subagent.

**Characteristics:**
- No real-time streaming of intermediate steps
- Parallel execution possible (multiple subagents)
- Each subagent gets fresh context budget
- Audit trail via execution logs

**Flow:**
```
Main Session                         Subagent
     │                                   │
     │ start_task_session(taskId)        │
     │ get_task_execution_prompt(taskId) │
     │ Task tool ───────────────────────>│
     │                                   │ log_task_progress()
     │                                   │ [execute task]
     │                                   │ complete_task_session()
     │<──────────────────────────────────│
     │ get_task_execution_log(taskId)    │
```

**Triggered by:** "run in parallel", "execute in background", multiple task numbers

## Consequences

### Positive

- Users get the execution mode that fits their needs
- Context isolation enables longer tasks without running out of context
- Parallel execution speeds up independent tasks
- Audit trail preserves what subagents did

### Negative

- Users lose real-time feedback in subagent mode
- Two mental models to understand
- Subagent mode requires explicit logging for visibility

### Neutral

- Mode detection based on user intent (keywords)
- Ambiguous requests prompt for clarification

## Implementation

### MCP Tools

- `get_task_execution_prompt` - Returns prompt-ready text for subagent
- `log_task_progress` - Subagent records execution steps
- `get_task_execution_log` - Main session retrieves audit trail

### Skill Updates

The `work-task` skill includes mode detection logic and handles both flows.

## Alternatives Considered

### Single Mode (Subagent Only)

Rejected: Users strongly prefer seeing real-time progress for many tasks.

### Single Mode (Inline Only)

Rejected: No way to achieve parallel execution or context isolation.

### Automatic Mode Selection

Rejected: User preference varies by situation. Same task might be inline when debugging, subagent when batch processing.

## References

- [work-task skill](../../packages/cli/skills/work-task/SKILL.md)
- MCP tools in [packages/mcp-server/src/index.ts](../../packages/mcp-server/src/index.ts)

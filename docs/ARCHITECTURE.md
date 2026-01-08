# Architecture Overview

This document provides a high-level overview of the dev-workflow architecture.

## Domain Model

```
┌─────────────────────────────────────────────────────────────────┐
│                         Issue                                    │
│  - id, number, title, description                               │
│  - type (FEATURE, BUG, ENHANCEMENT, TASK)                       │
│  - priority (LOW, MEDIUM, HIGH, CRITICAL)                       │
│  - status (OPEN, IN_PROGRESS, CLOSED)                           │
│  - acceptanceCriteria[], labels[]                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:1
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Plan                                    │
│  - id, issueId                                                  │
│  - summary, approach (markdown)                                 │
│  - estimatedComplexity (LOW, MEDIUM, HIGH, VERY_HIGH)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Task                                    │
│  - id, planId, order                                            │
│  - title, description, acceptanceCriteria[]                     │
│  - status (PENDING, IN_PROGRESS, COMPLETED, ABANDONED)          │
│  - source (generated, manual)                                   │
│  - sessionId, hookConfigLabels[], implementationPlan           │
└─────────────────────────────────────────────────────────────────┘
```

### Relationships

- **Issue** is the top-level entity representing work to be done
- **Plan** contains the implementation strategy for an issue (one plan per issue)
- **Task** represents individual implementation steps within a plan (ordered list)

## Package Structure

```
packages/
├── cli/                    # Command-line interface
│   ├── src/
│   │   ├── commands/       # CLI commands (init, uninit)
│   │   ├── application/    # Application services
│   │   ├── infrastructure/ # File system, config
│   │   └── ui/             # Web UI server (Fastify)
│   └── skills/             # Claude Code skills (SKILL.md files)
│
└── mcp-server/             # MCP server for Claude integration
    └── src/
        ├── domain/         # Domain entities and interfaces
        └── infrastructure/ # SQLite repositories (Drizzle ORM)
```

## Data Flow

### Issue Creation Flow

```
User Request
     │
     ▼
┌─────────────┐    ┌──────────────────┐    ┌────────────┐
│ Claude Code │───▶│ create_issue MCP │───▶│  Database  │
│   Session   │    │      tool        │    │  (SQLite)  │
└─────────────┘    └──────────────────┘    └────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │   Snapshot    │
                   │   (v1)        │
                   └───────────────┘
```

### Task Execution Flow

Tasks can execute in two modes:

**Inline Mode** (full visibility):

```
Main Session
     │
     │ start_task_session(taskId)
     │ [execute task - user sees everything]
     │ complete_task_session(taskId)
     ▼
```

**Subagent Mode** (parallel/isolated):

```
Main Session                         Subagent
     │                                   │
     │ start_task_session(taskId)        │
     │ get_task_execution_prompt(taskId) │
     │                                   │
     │ Task tool ───────────────────────▶│
     │                                   │ log_task_progress()
     │                                   │ [execute task]
     │                                   │ complete_task_session()
     │◀──────────────────────────────────│
     │ get_task_execution_log(taskId)    │
     ▼
```

See [ADR-001: Dual-Mode Task Execution](adr/001-dual-mode-task-execution.md) for details.

## Versioning System

The system maintains complete version history through **snapshots**.

### Snapshot Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        Snapshot                                  │
│  - id, issueNumber, version                                     │
│  - status (ACTIVE, ARCHIVED)                                    │
│  - snapshotType (MANUAL, ISSUE_UPDATE, PLAN_REGENERATION)       │
│  - issueState (JSON blob)                                       │
│  - planState (JSON blob)                                        │
│  - tasksState[] (JSON blob)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### When Snapshots Are Created

1. **Issue Creation**: Initial snapshot (v1) captures issue state
2. **Issue Update**: New snapshot captures updated issue + existing plan/tasks
3. **Plan Regeneration**: New snapshot captures full state after re-planning

### Reversion

Users can revert to any previous version using `revert_to_snapshot`. This creates a new snapshot based on the old state (non-destructive).

See [ADR-003: Snapshot Versioning](adr/003-snapshot-versioning.md) for rationale.

## Hook System

Tasks support lifecycle hooks for quality gates and automation.

### Hook Stages

| Stage        | When                      | Must Pass? |
| ------------ | ------------------------- | ---------- |
| preStart     | Before task → IN_PROGRESS | Yes        |
| postStart    | After task → IN_PROGRESS  | No         |
| preComplete  | Before task → COMPLETED   | Yes        |
| postComplete | After task → COMPLETED    | No         |
| onAbandon    | When task abandoned       | No         |

### Hook Configuration

Hooks are defined in `.track/issues/tasks/hooks/<label>.yml` files. Tasks reference hooks via `hookConfigLabels` array, allowing composition.

See [ADR-002: Hook Composition](adr/002-hook-composition.md) for design rationale.

## Key Tools Reference

### MCP Tools (packages/mcp-server)

Issue management:

- `create_issue` - Create new issue with optional template
- `get_issue` - Get issue by ID or number
- `list_issues` - List issues with filters
- `update_issue` - Update issue fields

Planning:

- `generate_plan` - Create/regenerate implementation plan
- `get_plan` - Get plan with tasks for an issue

Task execution:

- `start_task_session` - Begin work on a task
- `complete_task_session` - Mark task complete (runs pre-complete hooks)
- `abandon_task_session` - Abandon task with reason
- `update_task` - Update task fields (title, description, implementationPlan, etc.)
- `get_task_execution_prompt` - Get prompt for subagent execution
- `log_task_progress` - Record execution step (subagent audit trail)
- `get_task_execution_log` - Retrieve execution history

Versioning:

- `get_snapshot_history` - View all versions
- `revert_to_snapshot` - Restore previous version

### Skills (packages/cli/skills)

Skills are Claude Code extensions defined in `SKILL.md` files:

- **work-task** - Task lifecycle management (start, complete, abandon)
- **manage-issue** - Issue and plan management

See individual SKILL.md files for detailed behavior and trigger phrases.

## Database Schema

SQLite database with Drizzle ORM. Key tables:

- `issues` - Issue records
- `plans` - Implementation plans (one per issue)
- `tasks` - Task records (many per plan)
- `snapshots` - Version history (JSON state blobs)
- `task_status_history` - Audit trail for task status changes
- `task_execution_logs` - Subagent execution audit trail

Schema defined in: [packages/mcp-server/src/infrastructure/schema.ts](../packages/mcp-server/src/infrastructure/schema.ts)

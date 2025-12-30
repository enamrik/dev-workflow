# ADR-003: Snapshot Versioning

## Status

Accepted

## Context

Issues evolve over time:
- Requirements get refined
- Plans get regenerated with different approaches
- Tasks get added, modified, or abandoned

We needed version history that:
1. Captures complete state at any point
2. Allows reverting to previous versions
3. Maintains audit trail for accountability

## Decision

Use **full-state snapshots** that capture issue + plan + tasks as a unit.

### Snapshot Model

```typescript
interface Snapshot {
  id: string;
  issueNumber: number;
  version: number;              // 1, 2, 3, ...
  status: "ACTIVE" | "ARCHIVED";
  snapshotType: "MANUAL" | "ISSUE_UPDATE" | "PLAN_REGENERATION";

  // Complete state capture (JSON blobs)
  issueState: IssueState;
  planState: PlanState | null;
  tasksState: TaskState[];

  createdBy: string;
  createdAt: string;
  notes?: string;
}
```

### When Snapshots Are Created

1. **Issue Creation** (`MANUAL`)
   - Initial snapshot (v1) captures issue state
   - No plan or tasks yet

2. **Issue Update** (`ISSUE_UPDATE`)
   - When issue fields change (title, description, acceptance criteria)
   - Captures current plan and tasks along with updated issue

3. **Plan Regeneration** (`PLAN_REGENERATION`)
   - When `generate_plan` creates/recreates a plan
   - Captures issue + new plan + new tasks

### Reversion

Users can revert to any previous version:

```typescript
revert_to_snapshot(issueNumber: 5, version: 2)
```

This creates a **new snapshot** based on old state (non-destructive).

## Consequences

### Positive

- **Complete History**: Every significant change is captured
- **Safe Reversion**: Never lose data, reverts create new versions
- **Coherent State**: Issue + plan + tasks always consistent
- **Audit Trail**: Who changed what and when

### Negative

- **Storage Growth**: Each snapshot stores full state (JSON blobs)
- **No Partial Revert**: Can't revert just the plan without issue
- **Query Complexity**: Current state vs historical requires different queries

### Neutral

- Snapshots stored in `snapshots` table
- State stored as JSON for flexibility
- Version numbers are per-issue (not global)

## Alternatives Considered

### Diff-Based History

```typescript
// Rejected approach
interface Change {
  field: string;
  oldValue: any;
  newValue: any;
}
```

Rejected because:
- Complex to reconstruct state at any point
- Diff conflicts when multiple fields change
- Hard to ensure consistency across related entities

### Event Sourcing

```typescript
// Rejected approach
interface DomainEvent {
  type: "IssueCreated" | "PlanGenerated" | "TaskCompleted" | ...;
  payload: any;
}
```

Rejected because:
- Overkill for this use case
- Requires rebuilding state from events
- Adds significant complexity

### No Versioning

Just update in place, no history.

Rejected because:
- No way to recover from mistakes
- No audit trail
- Users lose context of how issue evolved

## Smart Task Matching

When regenerating a plan, the system attempts to preserve task state:

1. Compare new tasks against old tasks
2. Match by title similarity
3. Preserve status for matched tasks (especially IN_PROGRESS and COMPLETED)
4. Track `matchedFromTaskId` and `matchConfidence`

This means regenerating a plan doesn't lose work already done.

## Implementation

### Database Schema

```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  issue_state TEXT NOT NULL,  -- JSON
  plan_state TEXT,            -- JSON, nullable
  tasks_state TEXT NOT NULL,  -- JSON array
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notes TEXT
);
```

### MCP Tools

- `get_snapshot_history` - View all versions for an issue
- `revert_to_snapshot` - Restore previous version (creates new snapshot)

## References

- Snapshot domain in [packages/mcp-server/src/domain/snapshot.ts](../../packages/mcp-server/src/domain/snapshot.ts)
- Schema in [packages/mcp-server/src/infrastructure/schema.ts](../../packages/mcp-server/src/infrastructure/schema.ts)

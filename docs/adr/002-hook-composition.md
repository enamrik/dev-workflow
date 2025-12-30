# ADR-002: Hook Composition

## Status

Accepted

## Context

Tasks need lifecycle hooks for quality gates (e.g., run tests before completing) and automation (e.g., notify on completion). Different tasks need different hooks:

- Some tasks need unit tests
- Some need database migration checks
- Some need both unit and e2e tests
- Some need security scanning

We needed a system that's:
1. Flexible enough for varied requirements
2. Simple enough to configure
3. Composable for combining behaviors

## Decision

Use **composable hook labels** where each label references a YAML config file.

### Hook Configuration Files

Located at `.track/issues/tasks/hooks/<label>.yml`:

```yaml
# unit-tests.yml
preComplete:
  - command: "pnpm test"
    description: "Run unit tests"
    mustPass: true

# e2e-tests.yml
preComplete:
  - command: "pnpm test:e2e"
    description: "Run e2e tests"
    mustPass: true

# db-migration.yml
preStart:
  - command: "./scripts/check-pending-migrations.sh"
    description: "Check for pending migrations"
    mustPass: true
```

### Task Assignment

Tasks reference hooks via `hookConfigLabels` array:

```typescript
{
  id: "...",
  title: "Add OAuth2 authentication",
  hookConfigLabels: ["unit-tests", "e2e-tests", "security"]
}
```

### Hook Stages

| Stage | When | Must Pass? |
|-------|------|------------|
| preStart | Before IN_PROGRESS | Yes |
| postStart | After IN_PROGRESS | No |
| preComplete | Before COMPLETED | Yes |
| postComplete | After COMPLETED | No |
| onAbandon | When abandoned | No |

### Hook Merging

When a task has multiple labels, hooks are merged by stage:
- Same-stage hooks execute in label order
- First failure stops execution (for mustPass hooks)

## Consequences

### Positive

- **Composable**: Combine any hooks without inheritance hierarchies
- **Reusable**: Define once, use across many tasks
- **Discoverable**: `list_hook_configs` shows available hooks
- **Mutable**: Can add/remove hooks via `update_task_hook_configs`

### Negative

- Must define each hook combination explicitly
- No automatic hook inheritance from issue/plan level
- Hook files must exist in `.track/issues/tasks/hooks/`

### Neutral

- Hook results recorded in task status history
- Users can create custom hooks as needed

## Alternatives Considered

### Inheritance-Based Hooks

```typescript
// Rejected approach
interface Issue {
  hooks: Hook[]; // Inherited by all tasks
}
interface Plan {
  hooks: Hook[]; // Inherited, can override
}
interface Task {
  hooks: Hook[]; // Final, can override
}
```

Rejected because:
- Complex to reason about (which level wins?)
- Hard to see effective hooks for a task
- Override semantics become confusing

### Single Hook Per Task

```typescript
hookConfig: "unit-tests" // Only one allowed
```

Rejected because:
- Can't combine behaviors
- Forces creation of many combination configs (unit-and-e2e, unit-and-security, etc.)

### Inline Hook Definitions

```typescript
hooks: [
  { stage: "preComplete", command: "pnpm test" }
]
```

Rejected because:
- No reusability across tasks
- Bloats task data
- Hard to update hooks across many tasks

## Implementation

### MCP Tools

- `list_hook_configs` - List available hook configurations
- `update_task_hook_configs` - Change hooks for a task

### File Structure

```
.track/
└── issues/
    └── tasks/
        └── hooks/
            ├── unit-tests.yml
            ├── e2e-tests.yml
            ├── db-migration.yml
            └── security.yml
```

## References

- Task domain in [packages/mcp-server/src/domain/task.ts](../../packages/mcp-server/src/domain/task.ts)
- Hook config domain in [packages/mcp-server/src/domain/hook-config.ts](../../packages/mcp-server/src/domain/hook-config.ts)

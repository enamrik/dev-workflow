---
sidebar_position: 6
---

# Snapshots

Snapshots provide version history for issues, enabling time-travel and recovery.

## How Snapshots Work

Every significant change to an issue creates a snapshot:

- Issue created
- Issue updated
- Plan generated
- Plan regenerated
- Issue closed
- Manual revert

Snapshots capture the complete state of an issue, including plan and tasks.

## Viewing History

### Get Snapshot History

```typescript
get_snapshot_history({
  issueNumber: 1,
});
```

Returns list of snapshots with:

- Version number
- Timestamp
- Event type
- Actor (who made the change)
- Notes

### View Specific Version

```typescript
view_snapshot({
  issueNumber: 1,
  version: 3,
});
```

Returns the complete issue state at that version:

- Issue properties
- Plan (if any)
- Tasks (if any)

## Reverting to Previous State

If you need to undo changes:

```typescript
revert_to_snapshot({
  issueNumber: 1,
  version: 3,
  notes: "Reverting to previous plan - new requirements were incorrect",
});
```

This:

1. Loads the state from version 3
2. Creates a new snapshot with that state
3. Records the revert in history

:::info
Revert creates a new snapshot; it doesn't delete history. You can always see the full timeline.
:::

## Snapshot Events

| Event              | When Created                     |
| ------------------ | -------------------------------- |
| `ISSUE_CREATED`    | New issue created                |
| `ISSUE_UPDATED`    | Title, description, etc. changed |
| `PLAN_CREATED`     | First plan generated             |
| `PLAN_REGENERATED` | Plan updated/regenerated         |
| `ISSUE_CLOSED`     | Issue closed                     |
| `REVERT`           | Reverted to previous version     |

## Use Cases

### Recovering from Bad Changes

```
> I accidentally updated the wrong issue. Can we undo that?

# Check history
get_snapshot_history({ issueNumber: 5 })

# View the previous state
view_snapshot({ issueNumber: 5, version: 2 })

# Confirm and revert
revert_to_snapshot({ issueNumber: 5, version: 2, notes: "Undo accidental update" })
```

### Reviewing Plan Evolution

```
> Show me how the plan changed over time

# Get history
get_snapshot_history({ issueNumber: 5 })

# Compare versions
view_snapshot({ issueNumber: 5, version: 1 })  # Original plan
view_snapshot({ issueNumber: 5, version: 3 })  # Current plan
```

### Auditing Changes

Snapshots provide an audit trail:

- Who made each change
- When changes occurred
- What changed between versions

## Best Practices

1. **Add notes when reverting** - Explain why you're reverting
2. **Check history before major changes** - Understand current state
3. **Use snapshots for review** - Compare before/after
4. **Don't delete history** - It's your safety net

## Limitations

- Snapshots are per-issue (not per-task)
- Can't partially revert (all or nothing)
- Large issues with many tasks = larger snapshots

## Next Steps

- [View work in the web UI](/user-guide/web-ui)
- [Troubleshooting](/advanced/troubleshooting)

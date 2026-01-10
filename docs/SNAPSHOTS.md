# Snapshots

> This guide is part of the [dev-workflow documentation](../README.md).

Snapshots provide version history for issues, allowing you to view past states and revert changes. Every modification to an issue creates a new snapshot, providing a complete audit trail of how issues evolve over time.

## Key Concepts

| Concept         | Description                                              |
| --------------- | -------------------------------------------------------- |
| **Snapshot**    | A complete point-in-time capture of an issue's state     |
| **Version**     | Sequential number (1, 2, 3...) identifying each snapshot |
| **Time-travel** | Viewing an issue as it existed at any past version       |
| **Reversion**   | Restoring an issue to a previous version's state         |

## What Snapshots Capture

Each snapshot stores the complete issue state at that moment:

- Title and description
- Type, priority, and status
- Acceptance criteria
- Labels
- Template used
- Creation and update timestamps

Snapshots are created automatically whenever an issue is modified through MCP tools.

## Viewing Snapshot History

Use `get_snapshot_history` to see all versions of an issue:

```
get_snapshot_history
  issueNumber: 5
```

Response:

```json
{
  "issueNumber": 5,
  "currentVersion": 3,
  "snapshots": [
    {
      "version": 1,
      "createdAt": "2024-01-15T10:00:00Z",
      "createdBy": "claude-code",
      "changeType": "create",
      "notes": null
    },
    {
      "version": 2,
      "createdAt": "2024-01-16T14:30:00Z",
      "createdBy": "claude-code",
      "changeType": "update",
      "notes": null
    },
    {
      "version": 3,
      "createdAt": "2024-01-17T09:15:00Z",
      "createdBy": "claude-agent",
      "changeType": "update",
      "notes": null
    }
  ]
}
```

### History Fields

| Field        | Description                                       |
| ------------ | ------------------------------------------------- |
| `version`    | Sequential version number                         |
| `createdAt`  | When the snapshot was created                     |
| `createdBy`  | Agent/user who made the change                    |
| `changeType` | Type of change: `create`, `update`, or `revert`   |
| `notes`      | Optional notes (typically added during reversion) |

## Time-Travel: Viewing Past States

Use `view_snapshot` to see an issue as it existed at a specific version:

```
view_snapshot
  issueNumber: 5
  version: 1
```

Response:

```json
{
  "issueNumber": 5,
  "version": 1,
  "viewedAt": "2024-01-18T10:00:00Z",
  "snapshot": {
    "title": "Original title",
    "description": "Original description...",
    "type": "FEATURE",
    "priority": "MEDIUM",
    "status": "OPEN",
    "acceptanceCriteria": ["First criterion"],
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "isCurrentVersion": false,
  "totalVersions": 3
}
```

This is a **read-only** operation - it shows historical state without modifying anything.

## Reverting to a Previous Version

Use `revert_to_snapshot` to restore an issue to a previous state:

```
revert_to_snapshot
  issueNumber: 5
  version: 1
  notes: "Reverting to original scope after requirements changed"
```

Response:

```json
{
  "success": true,
  "issueNumber": 5,
  "revertedFrom": 3,
  "revertedTo": 1,
  "newVersion": 4,
  "message": "Reverted issue #5 from version 3 to version 1"
}
```

### How Reversion Works

1. Creates a **new snapshot** (doesn't delete history)
2. Copies the data from the target version
3. Marks the new snapshot with `changeType: "revert"`
4. Records the reversion notes
5. Issue continues forward from the new version

This means you can always see the full history, including what was reverted and why.

## Use Cases

### 1. Undoing Unwanted Changes

If an issue's description was accidentally modified:

```
# Check history to find the good version
get_snapshot_history
  issueNumber: 5

# Revert to that version
revert_to_snapshot
  issueNumber: 5
  version: 2
  notes: "Reverting accidental scope change"
```

### 2. Reviewing Evolution

To understand how an issue evolved over time:

```
# Get history
get_snapshot_history
  issueNumber: 5

# View each version to compare
view_snapshot
  issueNumber: 5
  version: 1

view_snapshot
  issueNumber: 5
  version: 2
```

### 3. Audit Trail

For compliance or review purposes, use snapshots to document:

- Who made changes and when
- What the issue looked like at each stage
- Why reversions were made (via notes)

### 4. Scope Recovery

If scope creep happened and you need to return to original requirements:

```
revert_to_snapshot
  issueNumber: 5
  version: 1
  notes: "Returning to original MVP scope"
```

## MCP Tools Reference

| Tool                   | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `get_snapshot_history` | Get version history showing all snapshots for an issue       |
| `view_snapshot`        | View the complete state of an issue at a specific version    |
| `revert_to_snapshot`   | Revert an issue to a previous version (creates new snapshot) |

For detailed tool parameters, see the [MCP Tools Reference](MCP_TOOLS.md#snapshot-versioning).

## Important Notes

1. **Non-destructive**: Reversion creates a new version, preserving history
2. **Issue-level only**: Snapshots capture issue state, not task states
3. **Automatic**: No action needed to create snapshots - they're created on every update
4. **Read access**: Time-travel (`view_snapshot`) is always safe and read-only
5. **Notes are optional**: But recommended for reversion to document the reason

## Architecture

Snapshots are stored in the `issue_snapshots` table with:

- Foreign key to the issue
- Version number (auto-incremented per issue)
- Complete serialized issue state (JSON)
- Metadata (createdAt, createdBy, changeType, notes)

See [ADR 003: Snapshot Versioning](adr/003-snapshot-versioning.md) for design decisions.

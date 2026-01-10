# Milestones

> This guide is part of the [dev-workflow documentation](../README.md).

Milestones provide time-bounded planning for grouping related issues. They help you organize work into sprints, releases, or any time-bounded goal with automatic status tracking based on issue progress.

## Key Concepts

| Concept                  | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| **Milestone**            | A time-bounded goal with start/end dates that groups related issues |
| **Auto-computed status** | Status automatically updates based on issue states and dates        |
| **Number format**        | Milestones use `M1`, `M2`, etc. format (like issues use `#1`, `#2`) |
| **Manual sign-off**      | Only COMPLETED status requires explicit confirmation                |

## Status Computation

Milestone status is computed automatically at read time based on issue states and dates:

| Status          | Condition                                               |
| --------------- | ------------------------------------------------------- |
| **PLANNED**     | No issues have started (all OPEN or no issues assigned) |
| **IN_PROGRESS** | At least one issue is IN_PROGRESS                       |
| **DELAYED**     | Past end date AND not all issues are CLOSED             |
| **COMPLETED**   | Manually set via `update_milestone` (requires sign-off) |

The status is never stored directly - it's computed each time you retrieve a milestone. This ensures the status always reflects the current state of assigned issues.

## Creating Milestones

Use the `create_milestone` tool with a title and date range:

```
create_milestone
  title: "Sprint 1"
  description: "Initial feature set"
  startDate: "2024-01-15"
  endDate: "2024-01-29"
```

Response:

```json
{
  "message": "Created milestone M1: Sprint 1",
  "milestone": {
    "number": 1,
    "title": "Sprint 1",
    "status": "PLANNED",
    "startDate": "2024-01-15",
    "endDate": "2024-01-29"
  }
}
```

### Date Format

Dates must be in `YYYY-MM-DD` format. The start date must be before or equal to the end date.

## Assigning Issues to Milestones

Use `assign_issue_to_milestone` to group issues:

```
assign_issue_to_milestone
  issueNumber: 5
  milestoneNumber: 1
```

Issues can only belong to one milestone at a time. Assigning to a new milestone removes the issue from any previous milestone.

## Viewing Milestones

### Get a Single Milestone

```
get_milestone
  milestoneNumber: 1
```

Returns milestone details with assigned issues:

```json
{
  "milestone": {
    "number": 1,
    "title": "Sprint 1",
    "status": "IN_PROGRESS",
    "startDate": "2024-01-15",
    "endDate": "2024-01-29"
  },
  "issues": [
    { "number": 5, "title": "Add OAuth", "status": "IN_PROGRESS", "type": "FEATURE" },
    { "number": 6, "title": "Fix login bug", "status": "OPEN", "type": "BUG" }
  ],
  "summary": {
    "totalIssues": 2,
    "openIssues": 1,
    "inProgressIssues": 1,
    "closedIssues": 0
  }
}
```

### List All Milestones

```
list_milestones
```

Or filter by computed status:

```
list_milestones
  status: "IN_PROGRESS"
```

## Updating Milestones

Use `update_milestone` to modify properties:

```
update_milestone
  milestoneNumber: 1
  updates:
    title: "Sprint 1 - Extended"
    endDate: "2024-02-05"
```

### Completing a Milestone

COMPLETED status requires manual sign-off (cannot be auto-computed):

```
update_milestone
  milestoneNumber: 1
  updates:
    status: "COMPLETED"
```

This is intentional - completing a milestone is a deliberate action, not something that happens automatically.

## Removing Issues from Milestones

To unassign an issue from its milestone:

```
remove_issue_from_milestone
  issueNumber: 5
```

## Deleting Milestones

When you delete a milestone, all assigned issues become unassigned:

```
delete_milestone
  milestoneNumber: 1
```

Response:

```json
{
  "message": "Deleted milestone M1: Sprint 1",
  "unassignedIssues": 2
}
```

## Web UI Integration

The Web UI provides a Milestones page (`/milestones`) with:

- **Timeline view**: Visual representation of milestone date ranges
- **Status indicators**: Color-coded by computed status
- **Issue counts**: Progress tracking for each milestone
- **Filter toggle**: Show/hide completed milestones

Access the milestones page from the navigation sidebar or directly at `/milestones`.

## MCP Tools Reference

| Tool                          | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `create_milestone`            | Create a new milestone with title and date range                |
| `get_milestone`               | Get milestone details by ID or number                           |
| `list_milestones`             | List all milestones, optionally filtered by status              |
| `update_milestone`            | Update milestone properties (title, description, dates, status) |
| `delete_milestone`            | Delete a milestone (unassigns all issues)                       |
| `assign_issue_to_milestone`   | Assign an issue to a milestone                                  |
| `remove_issue_from_milestone` | Unassign an issue from its milestone                            |

For detailed tool parameters, see the [MCP Tools Reference](MCP_TOOLS.md#milestone-management).

## Best Practices

1. **Size milestones appropriately**: 1-4 weeks typically works well
2. **Review status regularly**: Check for DELAYED milestones to adjust scope
3. **Use descriptions**: Add context about the milestone's goals
4. **Sign off consciously**: Don't mark COMPLETED until all work is verified
5. **Keep history**: Consider milestone planning when reviewing past work

---
sidebar_position: 5
---

# Milestones

Milestones group issues for time-bounded planning, helping you track progress toward goals.

## Creating Milestones

```typescript
create_milestone({
  title: "Q1 2025 Release",
  description: "First quarterly release with authentication and dashboard",
  startDate: "2025-01-01",
  endDate: "2025-03-31",
});
```

### Properties

| Property      | Description                    | Required |
| ------------- | ------------------------------ | -------- |
| `title`       | Milestone name                 | Yes      |
| `description` | Goals and scope                | No       |
| `startDate`   | Start date (YYYY-MM-DD)        | Yes      |
| `endDate`     | Target completion (YYYY-MM-DD) | Yes      |

## Milestone Status

Status is computed automatically from assigned issues:

| Status        | Condition                                    |
| ------------- | -------------------------------------------- |
| `PLANNED`     | No issues have started work                  |
| `IN_PROGRESS` | At least one issue is being worked on        |
| `DELAYED`     | Past end date with incomplete work           |
| `COMPLETED`   | All issues closed (requires manual sign-off) |

:::info
Only `COMPLETED` can be set manually. Other statuses are computed automatically.
:::

## Viewing Milestones

### Get Single Milestone

```typescript
get_milestone({
  milestoneNumber: 1,
});
```

### List All Milestones

```typescript
list_milestones({});
```

### Filter by Status

```typescript
list_milestones({
  status: "IN_PROGRESS",
});
```

## Managing Milestones

### Update Properties

```typescript
update_milestone({
  milestoneNumber: 1,
  updates: {
    title: "Q1 2025 Release (Extended)",
    endDate: "2025-04-15",
  },
});
```

### Mark as Completed

```typescript
update_milestone({
  milestoneNumber: 1,
  updates: {
    status: "COMPLETED",
  },
});
```

### Delete Milestone

```typescript
delete_milestone({
  milestoneNumber: 1,
});
```

Issues assigned to deleted milestones become unassigned.

## Assigning Issues

### Add Issue to Milestone

```typescript
assign_issue_to_milestone({
  issueNumber: 5,
  milestoneNumber: 1,
});
```

### Remove Issue from Milestone

```typescript
remove_issue_from_milestone({
  issueNumber: 5,
});
```

## Work Queue Integration

The work queue considers milestone deadlines when prioritizing:

```typescript
get_work_queue({});
```

Returns tasks sorted by:

1. Issues in milestones approaching deadline
2. Issue priority
3. Task readiness (dependencies met)

## Best Practices

### Scoping Milestones

| Good              | Avoid                  |
| ----------------- | ---------------------- |
| 2-6 week duration | Multi-month milestones |
| 3-8 issues        | 20+ issues             |
| Clear deliverable | Vague goals            |

### Naming Conventions

| Pattern | Example              |
| ------- | -------------------- |
| Version | v1.0, v2.1           |
| Quarter | Q1 2025, Q2 2025     |
| Sprint  | Sprint 1, Sprint 2   |
| Release | January Release, MVP |

### Progress Tracking

1. Check milestone status regularly
2. Move issues between milestones if needed
3. Adjust end dates proactively
4. Mark complete when done (manual sign-off)

## Example: Sprint Planning

```typescript
// Create sprint
create_milestone({
  title: "Sprint 3",
  description: "Focus: Authentication and API",
  startDate: "2025-01-13",
  endDate: "2025-01-24",
});

// Assign issues
assign_issue_to_milestone({ issueNumber: 5, milestoneNumber: 3 });
assign_issue_to_milestone({ issueNumber: 6, milestoneNumber: 3 });
assign_issue_to_milestone({ issueNumber: 7, milestoneNumber: 3 });

// Check progress
get_milestone({ milestoneNumber: 3 });

// Complete sprint
update_milestone({
  milestoneNumber: 3,
  updates: { status: "COMPLETED" },
});
```

## Next Steps

- [Track changes with snapshots](/user-guide/snapshots)
- [View in web UI](/user-guide/web-ui)

---
sidebar_position: 1
---

# Working with Issues

Issues are the top-level work items in dev-workflow. This guide covers creating, managing, and closing issues.

## Creating Issues

### Using Natural Language

The easiest way to create an issue is through natural conversation with Claude:

```
> I need to add user authentication to the API
```

Claude invokes the `dfl-work-request` skill and creates a structured issue with:

- Appropriate type (FEATURE, BUG, etc.)
- Priority level
- Acceptance criteria

### Using MCP Tools Directly

You can also use the `create_issue` tool:

```typescript
create_issue({
  title: "Add user authentication",
  description: "Implement JWT-based authentication for API endpoints",
  type: "FEATURE",
  priority: "HIGH",
  acceptanceCriteria: [
    "Users can register with email/password",
    "Users receive JWT token on login",
    "Protected routes require valid token",
  ],
});
```

## Issue Properties

| Property             | Description                     | Required                |
| -------------------- | ------------------------------- | ----------------------- |
| `title`              | Brief description (< 100 chars) | Yes                     |
| `description`        | Detailed explanation            | Yes                     |
| `type`               | FEATURE, BUG, ENHANCEMENT, TASK | No (auto-detected)      |
| `priority`           | LOW, MEDIUM, HIGH, CRITICAL     | No (defaults to MEDIUM) |
| `acceptanceCriteria` | List of completion criteria     | No                      |
| `labels`             | Custom key-value tags           | No                      |

## Issue Types

| Type          | Description                     | Use When                          |
| ------------- | ------------------------------- | --------------------------------- |
| `FEATURE`     | New functionality               | Adding new capabilities           |
| `BUG`         | Broken behavior                 | Fixing something that was working |
| `ENHANCEMENT` | Improvement to existing feature | Making something better           |
| `TASK`        | Generic work item               | Maintenance, documentation, etc.  |

### Custom Types

Create custom types for your project:

```typescript
create_type({
  name: "EPIC",
  displayName: "Epic",
  description: "Large feature spanning multiple issues",
  keywords: ["epic", "large", "umbrella"],
  color: "#9b59b6",
});
```

## Issue Lifecycle

```
PLANNED → OPEN → IN_PROGRESS → CLOSED
```

| Status        | Description                      |
| ------------- | -------------------------------- |
| `PLANNED`     | Issue created, no plan activated |
| `OPEN`        | Plan activated, tasks available  |
| `IN_PROGRESS` | At least one task being worked   |
| `CLOSED`      | All work complete                |

## Viewing Issues

### Get Single Issue

```typescript
get_issue({
  issueNumber: 1,
  includePlan: true, // Include tasks
});
```

### Search Issues

```typescript
search_issues({
  query: "authentication",
});
```

### Project Statistics

```typescript
get_project_stats({});
```

Returns counts by status, type, and priority.

### Work Queue

```typescript
get_work_queue({});
```

Returns prioritized list of issues needing attention and tasks ready for work.

## Updating Issues

```typescript
update_issue({
  issueNumber: 1,
  updates: {
    title: "Updated title",
    priority: "CRITICAL",
    acceptanceCriteria: ["New criterion"],
  },
});
```

:::warning
Don't update issues that have active work. Create a new issue instead if requirements have significantly changed.
:::

## Issue Labels

Labels support both simple tags and key-value pairs:

```typescript
update_issue({
  issueNumber: 1,
  updates: {
    labels: {
      urgent: "", // Simple tag
      product: "Auth", // Key-value pair
      sprint: "2024-Q1", // Key-value pair
    },
  },
});
```

## Milestones

Assign issues to milestones for time-bounded planning:

```typescript
assign_issue_to_milestone({
  issueNumber: 1,
  milestoneNumber: 1,
});
```

See [Milestones Guide](/user-guide/milestones) for more details.

## Closing Issues

### Normal Close

Close an issue when all tasks are complete:

```typescript
close_issue({
  issueNumber: 1,
});
```

This validates all tasks are in terminal state (COMPLETED or ABANDONED).

### Force Close

If you need to close an issue with incomplete tasks:

```typescript
close_issue({
  issueNumber: 1,
  force: true,
});
```

:::caution
Only use `force: true` when state has drifted from reality. All non-terminal tasks will be abandoned.
:::

## Deleting Issues

Only PLANNED issues can be deleted (soft delete):

```typescript
delete_issue({
  issueNumber: 1,
});
```

Once work begins (OPEN status), use `close_issue` instead.

### Restoring Deleted Issues

```typescript
restore_issue({
  issueNumber: 1,
});
```

## Merging Issues

Combine two related issues:

```typescript
// Create new issue combining both
merge_issues({
  sourceIssueNumber: 1,
  targetIssueNumber: 2,
  mode: "create_new",
  newTitle: "Combined authentication feature",
});

// Or fold source into target
merge_issues({
  sourceIssueNumber: 1,
  targetIssueNumber: 2,
  mode: "merge_into",
});
```

## Best Practices

### Writing Good Issue Titles

| Good                                      | Bad            |
| ----------------------------------------- | -------------- |
| "Add JWT authentication to API"           | "Fix auth"     |
| "Users cannot login with SSO"             | "Login broken" |
| "Optimize database queries for dashboard" | "Make faster"  |

### Writing Good Descriptions

Include:

- **Context**: Why is this needed?
- **Requirements**: What exactly should happen?
- **Constraints**: Any limitations or considerations?
- **Examples**: Concrete examples help Claude understand

### Effective Acceptance Criteria

- Be specific and testable
- Use checkboxes for multiple criteria
- Include edge cases
- Cover error scenarios

```
Acceptance Criteria:
- [ ] GET /api/users returns paginated list
- [ ] Pagination supports page and limit parameters
- [ ] Empty results return 200 with empty array
- [ ] Invalid page numbers return 400 error
```

## Next Steps

- [Create implementation plans](/user-guide/planning)
- [Execute tasks](/user-guide/task-execution)
- [Set up GitHub integration](/user-guide/github-integration)

---
sidebar_position: 2
---

# Planning Issues

Plans break down issues into actionable tasks with dependencies. Claude generates plans based on issue requirements.

## Generating Plans

### Using the Skill

The easiest way to plan is through conversation:

```
> Plan issue #2
```

Claude invokes `dfl-plan-issue` and generates a structured plan.

### Using MCP Tools

```typescript
generate_plan({
  issueNumber: 2,
  summary: "Implement JWT authentication",
  approach: "Create auth middleware, user model, and login endpoints",
  estimatedComplexity: "MEDIUM",
  tasks: [
    {
      id: "db",
      title: "Create user model and migration",
      description: "Set up database schema for users",
      type: "TASK",
      acceptanceCriteria: ["User table with id, email, password_hash"]
    },
    {
      id: "auth",
      title: "Implement authentication middleware",
      description: "JWT validation for protected routes",
      type: "TASK",
      dependsOn: ["db"]
    },
    {
      id: "login",
      title: "Create login endpoint",
      description: "POST /api/auth/login",
      type: "TASK",
      dependsOn: ["auth"]
    }
  ]
})
```

## Plan Properties

| Property | Description |
|----------|-------------|
| `summary` | Brief description of approach |
| `approach` | Detailed implementation strategy |
| `estimatedComplexity` | LOW, MEDIUM, HIGH, VERY_HIGH |
| `tasks` | Array of task definitions |

## Task Properties

| Property | Description | Required |
|----------|-------------|----------|
| `id` | Placeholder ID for dependencies | Yes |
| `title` | Brief task description | Yes |
| `description` | Detailed requirements | Yes |
| `type` | FEATURE, BUG, ENHANCEMENT, TASK | Yes |
| `dependsOn` | Array of task IDs this depends on | No |
| `acceptanceCriteria` | Completion criteria | No |
| `estimatedMinutes` | Time estimate | No |
| `implementationPlan` | Technical details for execution | No |

## Task Dependencies

Dependencies define execution order:

```json
{
  "tasks": [
    { "id": "db", "title": "Create schema" },
    { "id": "api", "title": "Build API", "dependsOn": ["db"] },
    { "id": "ui", "title": "Create UI", "dependsOn": ["api"] }
  ]
}
```

### How Dependencies Work

1. All tasks start as PLANNED
2. When plan is activated, tasks move to BACKLOG
3. When first task starts, BACKLOG tasks with no dependencies move to READY
4. Tasks with dependencies stay BACKLOG until dependencies complete
5. When a dependency completes, dependent tasks become READY

```
db (no deps)    → READY    → IN_PROGRESS → COMPLETED
api (deps: db)  → BACKLOG  → READY       → IN_PROGRESS → COMPLETED
ui (deps: api)  → BACKLOG  → BACKLOG     → READY       → ...
```

## Reviewing Plans

View a generated plan:

```typescript
get_plan({
  issueNumber: 2
})
```

### Plan Review Checklist

Before activating a plan, verify:

- [ ] Tasks are properly scoped (deployable units)
- [ ] Dependencies are correct
- [ ] Acceptance criteria are clear
- [ ] Types are appropriate
- [ ] Nothing is missing

## Modifying Plans

### Before Activation

Delete and regenerate:

```typescript
// Generate a new plan (replaces existing)
generate_plan({ ... })
```

### After Activation

Once a plan is activated, you can:

1. **Update individual tasks** - Use `update_task`
2. **Regenerate the plan** - Preserves in-progress tasks

```typescript
// Update task details
update_task({
  taskId: "task-uuid",
  description: "Updated description",
  acceptanceCriteria: ["New criteria"]
})

// Regenerate plan (preserves active tasks)
generate_plan({
  issueNumber: 2,
  // ... new plan
})
```

:::info
`generate_plan` automatically preserves tasks that are IN_PROGRESS or COMPLETED. New tasks from the regenerated plan are added alongside.
:::

## Activating Plans

After review, activate the plan to make tasks workable:

```typescript
move_issue_to_backlog({
  issueNumber: 2,
  skipGitHubSync: false  // Create GitHub issues
})
```

This:
1. Transitions issue: PLANNED → OPEN
2. Transitions tasks: PLANNED → BACKLOG
3. Creates GitHub issues (if enabled)
4. Adds tasks to GitHub Project board

## Plan States

### Pausing Work

Move all READY tasks back to BACKLOG:

```typescript
pause_issue({
  issueNumber: 2
})
```

Useful when:
- Switching to higher priority work
- Waiting on external dependency
- Team bandwidth constraints

### Resuming Work

Mark issue ready to work:

```typescript
move_issue_to_ready({
  issueNumber: 2
})
```

Transitions BACKLOG tasks to READY (if no dependencies).

## Good Planning Practices

### Task Scoping

Each task should be:

| Principle | Description |
|-----------|-------------|
| **Deployable** | Produces a working, testable change |
| **Independent** | Minimal dependencies on other tasks |
| **Testable** | Clear verification criteria |
| **Focused** | Single responsibility |

### Task Size Guidelines

| Complexity | Tasks | Task Size |
|------------|-------|-----------|
| LOW | 1-2 tasks | 1-2 hours each |
| MEDIUM | 2-4 tasks | 2-4 hours each |
| HIGH | 4-8 tasks | 2-4 hours each |
| VERY_HIGH | 8+ tasks | Consider breaking into multiple issues |

### Writing Implementation Plans

The `implementationPlan` field gives Claude execution context:

```json
{
  "title": "Add user authentication",
  "implementationPlan": "Use the existing User model in src/models/user.ts. Add passport-jwt middleware following the pattern in src/middleware/auth.ts. Tests should use the test helper at src/test/helpers/auth.ts."
}
```

This helps Claude:
- Find relevant code
- Follow existing patterns
- Use correct conventions

## Complexity Estimation

| Level | Description | Indicators |
|-------|-------------|------------|
| LOW | Simple change | 1-2 files, clear requirements, no dependencies |
| MEDIUM | Moderate change | 3-5 files, some design decisions |
| HIGH | Significant change | 5-10 files, architecture decisions, integration |
| VERY_HIGH | Major change | 10+ files, new patterns, significant risk |

## Example: Feature Plan

```typescript
generate_plan({
  issueNumber: 5,
  summary: "Add OAuth2 authentication with Google",
  approach: `
    1. Set up OAuth2 configuration
    2. Create callback handler
    3. Integrate with existing auth flow
    4. Add frontend login button
  `,
  estimatedComplexity: "MEDIUM",
  tasks: [
    {
      id: "config",
      title: "Configure OAuth2 provider settings",
      description: "Add Google OAuth credentials to config",
      type: "TASK",
      implementationPlan: "Add to src/config/auth.ts using env vars"
    },
    {
      id: "callback",
      title: "Implement OAuth callback handler",
      description: "Handle OAuth redirect and token exchange",
      type: "FEATURE",
      dependsOn: ["config"],
      acceptanceCriteria: [
        "Exchanges code for tokens",
        "Creates/updates user record",
        "Sets session cookie"
      ]
    },
    {
      id: "button",
      title: "Add Google login button to UI",
      description: "Frontend OAuth flow trigger",
      type: "FEATURE",
      dependsOn: ["callback"]
    },
    {
      id: "tests",
      title: "Add integration tests",
      description: "Test OAuth flow end-to-end",
      type: "TASK",
      dependsOn: ["button"]
    }
  ]
})
```

## Next Steps

- [Execute tasks](/user-guide/task-execution)
- [Set up GitHub integration](/user-guide/github-integration)
- [Track progress with milestones](/user-guide/milestones)

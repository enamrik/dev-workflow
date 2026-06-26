---
sidebar_position: 4
---

# Claude Skills

Claude skills provide structured workflows for common operations. Skills are automatically invoked by Claude based on user intent.

## Available Skills

| Skill                  | Description                   | Trigger                           |
| ---------------------- | ----------------------------- | --------------------------------- |
| `dwf-work-request`     | Entry point for new work      | "Add X", "Fix Y", "Implement Z"   |
| `dwf-manage-issue`     | Issue CRUD operations         | "Update issue #N", "Add criteria" |
| `dwf-plan-issue`       | Generate implementation plans | "Plan issue #N", "Create tasks"   |
| `dwf-work-task`        | Task execution lifecycle      | "Start task", "Work on task"      |
| `dwf-worker-task`      | Worker task execution         | Auto-invoked by workers           |
| `dwf-configure-github` | GitHub integration setup      | "Enable GitHub sync"              |
| `dwf-manage-milestone` | Milestone management          | "Create milestone"                |

## dwf-work-request

**Entry point for ALL new work.** Routes requests to appropriate skill.

### When Invoked

- "Add user authentication"
- "Fix the login bug"
- "Implement dark mode"
- "We need to refactor..."
- "Can you build..."

### What It Does

1. Analyzes the request
2. Determines if it's a new issue or update
3. Routes to `dwf-manage-issue` for creation
4. Applies appropriate template

### Example

```
User: "We need to add OAuth support"

Claude: Creates issue #5: Add OAuth authentication support
Type: FEATURE
Priority: MEDIUM

Acceptance Criteria:
- Users can sign in with Google
- OAuth tokens are securely stored
- Existing users can link accounts
```

## dwf-manage-issue

Handles issue creation, updates, and management.

### When Invoked

- "Update issue #5 with new requirements"
- "Add acceptance criteria to #3"
- "Change priority of #2 to critical"
- "Close issue #1"

### Operations

| Operation   | Example                  |
| ----------- | ------------------------ |
| Create      | "Create an issue for..." |
| Update      | "Update issue #N..."     |
| Close       | "Close issue #N"         |
| Delete      | "Delete issue #N"        |
| Change type | "Change #N to bug"       |

## dwf-plan-issue

Generates implementation plans with properly-scoped tasks.

### When Invoked

- "Plan issue #5"
- "Create implementation plan for #3"
- "Break down into tasks"
- "Generate tasks for..."

### What It Does

1. Analyzes the issue requirements
2. Designs implementation approach
3. Creates deployable task units
4. Establishes task dependencies
5. Presents plan for approval

### Example

```
User: "Plan issue #5"

Claude:
Generated plan for issue #5: Add OAuth support

Summary: Implement OAuth2 authentication with Google provider

Tasks:
1. Configure OAuth credentials (no deps)
2. Implement OAuth callback (deps: 1)
3. Add frontend login button (deps: 2)
4. Write integration tests (deps: 3)

Estimated complexity: MEDIUM

Approve this plan?
```

## dwf-work-task

Manages the complete task execution lifecycle.

### When Invoked

- "Start task #5.1"
- "Work on task #3.2"
- "Begin task..."
- "Pick up task..."

### Lifecycle

1. **Load session** - Creates worktree, sets up environment
2. **Implement** - Makes code changes
3. **Create PR** - Commits, pushes, creates pull request
4. **Submit** - Marks for review
5. **Complete** - Verifies merge, cleans up

### Example

```
User: "Start task #5.1"

Claude:
Starting task #5.1: Configure OAuth credentials

Mode: isolated
Worktree: ~/.dwf/track/project/worktrees/issue-5-task-1
Branch: issue-5/task-1-configure-oauth

Ready to implement. What would you like me to do first?
```

## dwf-worker-task

Executes tasks for background workers. Same as `dwf-work-task` but:

- Requires worker ID
- Must call `end_worker_session` when done
- No interactive prompts

## dwf-configure-github

Sets up GitHub integration.

### When Invoked

- "Enable GitHub sync"
- "Set up GitHub Projects integration"
- "Configure issue labels"

### What It Does

1. Validates `gh` CLI authentication
2. Detects repository from remotes
3. Configures sync settings
4. Sets up column mapping

## dwf-manage-milestone

Manages milestones for time-bounded planning.

### When Invoked

- "Create a milestone for Q1"
- "Update milestone dates"
- "Assign issues to sprint"

### Operations

| Operation | Example                       |
| --------- | ----------------------------- |
| Create    | "Create milestone Q1 2025"    |
| Update    | "Extend milestone by 2 weeks" |
| Assign    | "Add #5 to Q1 milestone"      |
| Close     | "Complete the milestone"      |

## Skill Invocation

### Automatic

Claude automatically invokes skills based on intent:

```
User: "I need to add a health check endpoint"
→ Claude invokes dwf-work-request
→ Routes to dwf-manage-issue
→ Creates issue with FEATURE type
```

### Explicit

Use slash commands to explicitly invoke:

```
/dwf-work-request Add health check endpoint
/dwf-plan-issue 5
/dwf-work-task 5.1
```

## Skill Files

Skills are located in `.claude/skills/`:

```
.claude/skills/
├── dwf-work-request/
│   └── SKILL.md
├── dwf-manage-issue/
│   └── SKILL.md
├── dwf-plan-issue/
│   └── SKILL.md
├── dwf-work-task/
│   └── SKILL.md
├── dwf-worker-task/
│   └── SKILL.md
├── dwf-configure-github/
│   └── SKILL.md
└── dwf-manage-milestone/
    └── SKILL.md
```

## Best Practices

### Use Natural Language

Skills are designed for natural interaction:

```
# Good
"I need to fix the login timeout issue"
"Plan the authentication feature"
"Start working on the first task"

# Also works but less natural
"/dwf-work-request fix login timeout"
```

### Let Skills Route

Don't micromanage skill selection:

```
# Good - let dwf-work-request route appropriately
"Add a new API endpoint for users"

# Unnecessary - dwf-work-request will handle this
"/dwf-manage-issue create issue for API endpoint"
```

### Approve Plans Before Working

Always review and approve plans:

```
User: "Plan issue #5"
Claude: [presents plan]
User: "Yes, looks good" or "Change task 2 to..."
```

## Next Steps

- [Architecture Overview](/advanced/architecture)
- [Background Workers](/advanced/workers)

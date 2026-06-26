---
sidebar_position: 4
---

# Claude Skills

Claude skills provide structured workflows for common operations. Skills are automatically invoked by Claude based on user intent.

## Available Skills

| Skill                  | Description                   | Trigger                           |
| ---------------------- | ----------------------------- | --------------------------------- |
| `dfl-work-request`     | Entry point for new work      | "Add X", "Fix Y", "Implement Z"   |
| `dfl-manage-issue`     | Issue CRUD operations         | "Update issue #N", "Add criteria" |
| `dfl-plan-issue`       | Generate implementation plans | "Plan issue #N", "Create tasks"   |
| `dfl-work-task`        | Task execution lifecycle      | "Start task", "Work on task"      |
| `dfl-worker-task`      | Worker task execution         | Auto-invoked by workers           |
| `dfl-configure-github` | GitHub integration setup      | "Enable GitHub sync"              |
| `dfl-manage-milestone` | Milestone management          | "Create milestone"                |

## dfl-work-request

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
3. Routes to `dfl-manage-issue` for creation
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

## dfl-manage-issue

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

## dfl-plan-issue

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

## dfl-work-task

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
Worktree: ~/.dfl/track/project/worktrees/issue-5-task-1
Branch: issue-5/task-1-configure-oauth

Ready to implement. What would you like me to do first?
```

## dfl-worker-task

Executes tasks for background workers. Same as `dfl-work-task` but:

- Requires worker ID
- Must call `end_worker_session` when done
- No interactive prompts

## dfl-configure-github

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

## dfl-manage-milestone

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
→ Claude invokes dfl-work-request
→ Routes to dfl-manage-issue
→ Creates issue with FEATURE type
```

### Explicit

Use slash commands to explicitly invoke:

```
/dfl-work-request Add health check endpoint
/dfl-plan-issue 5
/dfl-work-task 5.1
```

## Skill Files

Skills are located in `.claude/skills/`:

```
.claude/skills/
├── dfl-work-request/
│   └── SKILL.md
├── dfl-manage-issue/
│   └── SKILL.md
├── dfl-plan-issue/
│   └── SKILL.md
├── dfl-work-task/
│   └── SKILL.md
├── dfl-worker-task/
│   └── SKILL.md
├── dfl-configure-github/
│   └── SKILL.md
└── dfl-manage-milestone/
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
"/dfl-work-request fix login timeout"
```

### Let Skills Route

Don't micromanage skill selection:

```
# Good - let dfl-work-request route appropriately
"Add a new API endpoint for users"

# Unnecessary - dfl-work-request will handle this
"/dfl-manage-issue create issue for API endpoint"
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

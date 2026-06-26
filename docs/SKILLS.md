# Claude Skills Guide

> This guide is part of the [dev-workflow documentation](../README.md).

Claude skills enable natural language workflow automation in dev-workflow. When you describe work to Claude Code, these skills activate automatically to handle issue creation, planning, task execution, and more.

## How Skills Work

Skills are semantic triggers that Claude Code recognizes from your natural language input. You don't invoke them directly - Claude detects when a skill is relevant and activates it.

```
You: "I want to add user authentication"
     ↓
Claude recognizes this as a work request
     ↓
dfl-work-request skill activates
     ↓
Routes to dfl-manage-issue for issue creation
     ↓
Chains to dfl-plan-issue for planning
```

## Skill Overview

| Skill                                         | Purpose                             | Typical Triggers                         |
| --------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| [dfl-work-request](#dfl-work-request)         | Entry point for all new work        | "add X", "fix Y", "implement Z"          |
| [dfl-manage-issue](#dfl-manage-issue)         | Issue lifecycle management          | "update issue #N", "merge issues"        |
| [dfl-plan-issue](#dfl-plan-issue)             | Generate implementation plans       | "plan issue #N", "break down into tasks" |
| [dfl-work-task](#dfl-work-task)               | Dispatch tasks to workers           | "start task #1", "work on task"          |
| [dfl-worker-task](#dfl-worker-task)           | Execute tasks (create PR, complete) | Used by workers or inline execution      |
| [dfl-configure-github](#dfl-configure-github) | GitHub integration setup            | "enable GitHub sync", "configure labels" |
| [dfl-manage-milestone](#dfl-manage-milestone) | Milestone management                | "create milestone", "assign to M1"       |

## Skill Interaction Flow

```
User describes work
        ↓
┌─────────────────────┐
│  dfl-work-request   │  ← Entry point for all new work
└─────────┬───────────┘
          ↓
┌─────────────────────┐
│  dfl-manage-issue   │  ← Creates/updates issues
└─────────┬───────────┘
          ↓
┌─────────────────────┐
│   dfl-plan-issue    │  ← Generates tasks
└─────────┬───────────┘
          ↓
    User approves plan
          ↓
┌─────────────────────┐
│    dfl-work-task    │  ← Dispatch decision
└────┬───────────┬────┘
     ↓           ↓
  Workers    No workers
  online      available
     ↓           ↓
  Dispatch   ┌─────────────────────┐
  to queue   │  dfl-worker-task    │ ← Inline execution
             └─────────────────────┘
```

---

## dfl-work-request

**Purpose:** Entry point for ALL new work, regardless of size.

### When It Activates

Any request to build, fix, add, or create something:

| User Says                       | Interpretation               |
| ------------------------------- | ---------------------------- |
| "Add a logout button"           | Feature request              |
| "Fix the login bug"             | Bug report                   |
| "Can you implement dark mode?"  | Feature request              |
| "Look into why X is slow"       | Bug investigation            |
| "We need better error handling" | Enhancement                  |
| "Import #42"                    | Import existing GitHub issue |

### What It Does

1. Recognizes the work request
2. Routes to `dfl-manage-issue` for issue creation
3. Passes along context (requirements, preferences)

### Key Decision Points

- **Size doesn't matter**: A 2-line fix gets an issue, a 200-line feature gets an issue
- **Bug investigations need issues**: "Why isn't X working?" creates an issue
- **Pure exploration doesn't**: "How does routing work?" is just a question

### Exceptions

Skip issue creation only when:

- User explicitly says "don't create an issue" or "just do it quick"
- User is asking questions, not requesting work
- Pure exploration (understanding code, not changing it)

---

## dfl-manage-issue

**Purpose:** Handles issue creation, updates, merges, and imports.

### When It Activates

- **Create:** "create issue", "new feature", "report bug"
- **Update:** "update issue #5", "add acceptance criteria"
- **Import:** "import #42", "import github.com/.../issues/42"
- **Merge:** "merge #3 into #5", "combine these issues"
- **Close:** "close issue #N"

### What It Does

1. **Separates information levels:**

   | Level        | Belongs In | Example                           |
   | ------------ | ---------- | --------------------------------- |
   | Requirements | Issue      | "Users should be able to sign in" |
   | Approach     | Plan       | "Use passport.js with Redis"      |
   | Specifics    | Tasks      | "Callback at /auth/callback"      |

2. **Creates the issue** with requirement-level information only
3. **Chains to planning** automatically

### Key Decision Points

- **Requirements go in issues**: What the user wants, not how to build it
- **Auto-chains to planning**: After creating/updating, generates a plan
- **Ask before closing**: Always confirm before closing an issue

### Merge Modes

| Mode         | What Happens                                             |
| ------------ | -------------------------------------------------------- |
| `create_new` | Creates new issue from both sources; originals unchanged |
| `merge_into` | Folds source into target; source is soft-deleted         |

---

## dfl-plan-issue

**Purpose:** Generates implementation plans with properly-scoped tasks.

### When It Activates

- "plan issue #N", "create implementation plan"
- "break down into tasks", "how should we implement this?"
- Auto-chained from `dfl-manage-issue` after issue creation

### What It Does

1. Analyzes the issue requirements
2. Designs tasks as **deployable units** (not micro-steps)
3. Defines task dependencies
4. Generates the plan and tasks
5. **Asks user to approve** before starting work

### Key Decision Points

#### Task Design Philosophy

A task is NOT a small step. A task is a **commitable, deployable unit**:

| Good Task                                    | Bad Tasks                                            |
| -------------------------------------------- | ---------------------------------------------------- |
| "Add OAuth2 authentication with tests"       | "Add OAuth handler" + "Write tests for OAuth"        |
| "Implement user profile API with validation" | "Create endpoint" + "Add validation" + "Write tests" |

#### Special Handling

| Issue Type              | Planning Approach                                  |
| ----------------------- | -------------------------------------------------- |
| **BUG**                 | Single task: "Investigate and fix: [bug title]"    |
| **SPIKE**               | Single task: "Spike: [title]" (timeboxed research) |
| **FEATURE/ENHANCEMENT** | Break into deployable units with dependencies      |

#### Task Dependencies

Dependencies control execution order:

```json
{
  "tasks": [
    { "id": "db", "title": "Add database schema", "dependsOn": [] },
    { "id": "api", "title": "Implement API", "dependsOn": ["db"] },
    { "id": "ui", "title": "Build UI", "dependsOn": ["api"] }
  ]
}
```

- Tasks with unmet dependencies stay in BACKLOG
- Only tasks with all dependencies COMPLETED become READY
- Empty `dependsOn` means can run in parallel

---

## dfl-work-task

**Purpose:** Dispatch decision when starting a task. Routes to workers or executes inline.

### When It Activates

- "start task #1", "work on task", "begin task"
- "let's work on the first task", "I'm ready to implement"

### What It Does

1. Identifies the task to work on
2. Checks if workers are available
3. **If workers online:** Dispatches to queue, STOPS
4. **If no workers:** Invokes `dfl-worker-task` for inline execution

### Key Decision Points

- **Dispatch is preferred**: Workers handle tasks when available
- **This skill doesn't execute**: It only decides where tasks run
- **Inline hints bypass dispatch**: "start task inline" or "work on it here"

### Inline Execution Keywords

These bypass worker dispatch:

- "run inline", "inline"
- "run here", "here", "locally"
- "don't dispatch", "I'll work on it"

---

## dfl-worker-task

**Purpose:** Execute tasks - load, implement, create PR, and complete.

### When It Activates

- Invoked by `dfl-work-task` for inline execution
- Used directly by background workers

### What It Does

1. **Loads the task session** (creates worktree/branch in isolated mode)
2. **Presents task to user** with acceptance criteria
3. **Implements the task** (this is where actual coding happens)
4. **Creates PR** and pushes changes
5. **Submits for review** (transitions to PR_REVIEW)
6. **Waits for merge**, then calls `complete_task`
7. **(Workers only)** Calls `end_worker_session` as terminal action

### Key Decision Points

#### Execution Modes

| Mode                   | Git Setup         | PR Workflow          | Best For                     |
| ---------------------- | ----------------- | -------------------- | ---------------------------- |
| **Isolated** (default) | Worktree + branch | Full PR workflow     | Feature work, parallel tasks |
| **Branch**             | Branch only       | Full PR workflow     | Sequential work              |
| **Main**               | Works on main     | No PR, direct commit | Trivial fixes, docs          |

#### Session Constraints

- **One task at a time per session**: Complete before starting another
- **Use worktree path in isolated mode**: All file operations must use the worktree path
- **Workers must pass workerId**: Required for worker enforcement

See [Task Execution Guide](TASK_EXECUTION.md) for the complete lifecycle and PR workflow.

---

## dfl-configure-github

**Purpose:** Configure GitHub integration for issue syncing.

### When It Activates

- "enable GitHub sync", "set up GitHub", "connect to GitHub"
- "configure GitHub labels", "add to project board"
- "disable GitHub", "check GitHub status"

### What It Does

1. Validates gh CLI is authenticated
2. Configures repository connection
3. Sets up optional GitHub Projects integration
4. Configures label mappings

### Key Decision Points

#### Prerequisites

- `gh` CLI must be installed
- Must run `gh auth login` first
- User needs repository access

#### Settings Actions

| Action                     | Purpose                               |
| -------------------------- | ------------------------------------- |
| `get_settings`             | Check current configuration           |
| `enable_github`            | Enable sync with validation           |
| `disable_github`           | Stop syncing (existing issues remain) |
| `configure_github`         | Update labels, project ID, assignee   |
| `configure_column_mapping` | Map task statuses to project columns  |

See [GitHub Integration Guide](GITHUB_INTEGRATION.md) for detailed configuration.

---

## dfl-manage-milestone

**Purpose:** Manage time-bounded goals that group related issues.

### When It Activates

- "create milestone", "new milestone for Q1"
- "update milestone M1", "extend deadline"
- "add issue #5 to M1", "remove from milestone"
- "show milestones", "list active milestones"

### What It Does

1. Creates milestones with start/end dates
2. Assigns issues to milestones
3. Updates milestone status and dates
4. Shows progress (issues completed vs total)

### Key Decision Points

#### Milestone Status

| Status      | Meaning                        |
| ----------- | ------------------------------ |
| PLANNED     | Future milestone, not started  |
| IN_PROGRESS | Currently active               |
| COMPLETED   | All work finished              |
| DELAYED     | Past end date but not complete |

#### Date Handling

- Uses ISO format: YYYY-MM-DD
- Converts relative dates ("next week", "end of Q1")
- Start date must be before end date

See [Milestones Guide](MILESTONES.md) for timeline planning.

---

## Tips for Working with Skills

### Let Skills Chain Naturally

Don't try to invoke skills directly - describe what you want:

| Instead of              | Say                                    |
| ----------------------- | -------------------------------------- |
| "Run dfl-manage-issue"  | "Create an issue for adding dark mode" |
| "Invoke dfl-plan-issue" | "Break this down into tasks"           |
| "Use dfl-work-task"     | "Start working on task 1"              |

### Provide Context

Skills work better with context:

```
# Good - provides requirements
"Add OAuth authentication - users should sign in with Google,
sessions should persist across browser refresh"

# Less helpful - no requirements
"Add OAuth"
```

### Trust the Flow

- Work requests → issues → plans → tasks → PRs
- Each step chains automatically
- Approval is asked before work begins

# GitHub Integration

> This guide is part of the [dev-workflow documentation](../README.md).

dev-workflow integrates with GitHub to sync tasks as GitHub Issues and manage them on GitHub Projects boards. This enables teams to track work in GitHub while using dev-workflow's structured planning.

## Overview

### What Syncs

| dev-workflow | GitHub                | Direction                                   |
| ------------ | --------------------- | ------------------------------------------- |
| Tasks        | Issues                | Push-only (dev-workflow is source of truth) |
| Task status  | Project board column  | Push-only                                   |
| Task type    | Issue label           | Push-only                                   |
| Task labels  | Project custom fields | Push-only (if configured)                   |

### What Doesn't Sync

- dev-workflow **issues** (only tasks sync to GitHub)
- Comments or discussion
- Assignees (except auto-assign on IN_PROGRESS)
- Pull requests (handled separately via `create_pr`)

## Setup

### Prerequisites

1. **GitHub CLI**: Install and authenticate `gh`:

   ```bash
   brew install gh  # or your package manager
   gh auth login
   ```

2. **GitHub Repository**: Your project must be in a git repo with a GitHub remote.

3. **GitHub Project (optional)**: For kanban board integration, create a GitHub Project (V2).

### Enabling GitHub Sync

Use the `update_settings` MCP tool with `enable_github` action:

```
update_settings(action: "enable_github")
```

This:

- Validates `gh` CLI authentication
- Auto-detects repository from git remotes
- Enables task → GitHub issue sync

**With GitHub Projects:**

```
update_settings(
  action: "enable_github",
  github: {
    projectId: "PVT_kwDO..."  // Your project ID
  }
)
```

Find your Project ID:

1. Open your GitHub Project
2. Click **Settings** (⚙️) → **Copy project ID**

**With auto-assign:**

```
update_settings(
  action: "enable_github",
  github: {
    projectId: "PVT_kwDO...",
    assignee: "username"  // No @ prefix
  }
)
```

### Checking Configuration

```
update_settings(action: "get_settings")
```

Returns current config, `gh` CLI status, and effective column mapping.

### Disabling Sync

```
update_settings(action: "disable_github")
```

Preserves configuration but stops syncing. Existing GitHub issues remain.

## GitHub Projects Integration

### Column Mapping

When tasks change status, they move to the corresponding project board column:

| Task Status | Default Column |
| ----------- | -------------- |
| BACKLOG     | Backlog        |
| READY       | Ready          |
| IN_PROGRESS | In Progress    |
| PR_REVIEW   | In Review      |
| COMPLETED   | Done           |
| ABANDONED   | Done           |

### Custom Column Names

If your project uses different column names:

```
update_settings(
  action: "configure_column_mapping",
  github: {
    columnMapping: {
      READY: "To Do",           // Map READY → "To Do" instead of "Ready"
      PR_REVIEW: "Code Review"  // Map PR_REVIEW → "Code Review"
    }
  }
)
```

Only specify columns you want to override. Others use defaults.

### Reset to Defaults

```
update_settings(
  action: "configure_column_mapping",
  resetColumnMapping: true
)
```

### Project Custom Fields

Task labels can sync to GitHub Project custom fields. Configure the mapping in project settings.

Use `list_available_labels` to discover available fields:

```
update_settings(action: "list_available_labels")
```

## Label Configuration

### Type Labels

Each task type maps to a GitHub label:

| Task Type   | Default Label |
| ----------- | ------------- |
| FEATURE     | feature       |
| BUG         | bug           |
| ENHANCEMENT | enhancement   |
| TASK        | task          |

All synced issues also get a `task` label to distinguish them from regular issues.

### Custom Type Mappings

Override type-to-label mapping (maps internal issue/task types to external labels):

```
update_settings(
  action: "configure_github",
  github: {
    labels: {
      typeMappings: {
        FEATURE: "type: feature",
        BUG: "type: bug"
      }
    }
  }
)
```

### Additional Labels

Apply custom labels to all synced issues:

```
update_settings(
  action: "configure_github",
  github: {
    labels: {
      customLabels: ["dev-workflow", "automated"]
    }
  }
)
```

## How Sync Works

### Task Activation Flow

When you call `move_issue_to_backlog`:

1. **For each PLANNED task:**
   - Creates a GitHub issue with task title/description
   - Applies type and custom labels
   - Adds to GitHub Project (if configured)
   - Moves to Backlog column
   - Transitions task: PLANNED → BACKLOG

2. **For the parent issue:**
   - Transitions: PLANNED → OPEN

### Task Status Sync

When task status changes:

| Status Change     | GitHub Actions                                            |
| ----------------- | --------------------------------------------------------- |
| Any → IN_PROGRESS | Move to "In Progress" column, auto-assign (if configured) |
| Any → PR_REVIEW   | Move to "In Review" column                                |
| Any → COMPLETED   | Close GitHub issue, move to "Done" column                 |
| Any → ABANDONED   | Close GitHub issue, move to "Done" column                 |

### GitHub Issue Body

Synced issues include:

- Task description
- Acceptance criteria (as checkboxes)
- Footer linking to dev-workflow task: `Task #N.T: Title`

## Importing GitHub Issues

Import existing GitHub issues into dev-workflow:

```
import_github_issue(githubIssueNumber: 42)
```

Or by URL:

```
import_github_issue(
  githubIssueUrl: "https://github.com/owner/repo/issues/42"
)
```

This:

- Creates a dev-workflow issue from the GitHub issue
- Infers type and priority from GitHub labels
- Stores `sourceGitHubIssueNumber` to track the link

### Sub-Issue Creation

After importing, generate a plan with `generate_plan`. When you call `move_issue_to_backlog`:

**1 task:** Links directly to the parent GitHub issue (no new issue created)

**Multiple tasks:** Creates sub-issues under the parent:

- Each task becomes a new GitHub issue
- Sub-issues are linked to the parent via GitHub's sub-issue feature
- Parent issue tracks overall progress

## Repairing Sync State

If sync gets out of sync (partial failures, manual changes), use:

```
sync_issue(issueNumber: 123)
```

This:

- **Creates** missing GitHub issues for tasks
- **Links** existing issues found by title search
- **Verifies** already-linked issues still exist
- **Repairs** project board state

Idempotent: safe to run multiple times.

## Troubleshooting

### "GitHub CLI (gh) is not authenticated"

Run:

```bash
gh auth login
```

### "Not in a GitHub repository"

Ensure:

1. Current directory is inside a git repo
2. Repo has a GitHub remote (`git remote -v`)

### "GitHub Project not found"

- Verify project ID format: `PVT_...`
- Check you have access to the project
- Try copying ID fresh from project settings

### Task Not Moving Columns

1. Check task has `remoteProjectId` (view task details)
2. Verify column names match your project
3. Run `sync_issue` to repair state

### Labels Not Being Created

- dev-workflow creates labels on first use
- Check you have repo write permissions
- Labels use lowercase type names by default

### Stale Sync State

If a task's GitHub sync is incorrect:

1. Check GitHub issue still exists
2. Run `sync_issue(issueNumber: N)` to repair
3. If issue was deleted, sync will clear the link and create new

## Best Practices

1. **Enable Projects for visibility** - Kanban boards give team visibility into task progress

2. **Use consistent column names** - Or configure mapping to match your conventions

3. **Don't edit synced issues on GitHub** - Changes aren't pulled back; dev-workflow is source of truth

4. **Import before planning** - Import GitHub issues before creating plans; sub-issues work best with imported issues

5. **Check sync after errors** - If operations fail partway, run `sync_issue` to repair

## Related

- [Quick Start](QUICK_START.md) - Getting started with dev-workflow
- [Task Execution](TASK_EXECUTION.md) - Task lifecycle and PR workflow
- [MCP Tools Reference](MCP_TOOLS.md) - Complete tool documentation

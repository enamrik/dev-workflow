---
sidebar_position: 4
---

# GitHub Integration

dev-workflow integrates with GitHub to sync tasks as GitHub Issues and manage them on GitHub Projects boards.

## Overview

### What Syncs

| dev-workflow | GitHub | Direction |
|--------------|--------|-----------|
| Tasks | Issues | Push-only |
| Task status | Project board column | Push-only |
| Task type | Issue label | Push-only |
| Task labels | Project custom fields | Push-only |

### What Doesn't Sync

- dev-workflow **issues** (only tasks sync)
- Comments or discussion
- Assignees (except auto-assign on IN_PROGRESS)
- Pull requests (handled via `create_pr`)

## Setup

### Prerequisites

1. **GitHub CLI**: Install and authenticate

   ```bash
   brew install gh  # or your package manager
   gh auth login
   ```

2. **GitHub Repository**: Project must have a GitHub remote

3. **GitHub Project (optional)**: For kanban boards, create a GitHub Project V2

### Enabling Sync

```typescript
update_settings({
  action: "enable_github"
})
```

This:
- Validates `gh` CLI authentication
- Auto-detects repository from git remotes
- Enables task → GitHub issue sync

### With GitHub Projects

```typescript
update_settings({
  action: "enable_github",
  github: {
    projectId: "PVT_kwDO..."  // Your project ID
  }
})
```

Find your Project ID:
1. Open your GitHub Project
2. Click **Settings** (⚙️) → **Copy project ID**

### With Auto-Assign

```typescript
update_settings({
  action: "enable_github",
  github: {
    projectId: "PVT_kwDO...",
    assignee: "username"  // No @ prefix
  }
})
```

### Checking Configuration

```typescript
update_settings({
  action: "get_settings"
})
```

### Disabling Sync

```typescript
update_settings({
  action: "disable_github"
})
```

## Column Mapping

Task status maps to project board columns:

| Task Status | Default Column |
|-------------|----------------|
| BACKLOG | Backlog |
| READY | Ready |
| IN_PROGRESS | In Progress |
| PR_REVIEW | In Review |
| COMPLETED | Done |
| ABANDONED | Done |

### Custom Column Names

```typescript
update_settings({
  action: "configure_column_mapping",
  github: {
    columnMapping: {
      READY: "To Do",
      PR_REVIEW: "Code Review"
    }
  }
})
```

### Reset to Defaults

```typescript
update_settings({
  action: "configure_column_mapping",
  resetColumnMapping: true
})
```

## Label Configuration

### Type Labels

| Task Type | Default Label |
|-----------|---------------|
| FEATURE | feature |
| BUG | bug |
| ENHANCEMENT | enhancement |
| TASK | task |

All synced issues also get a `task` label.

### Custom Type Mappings

```typescript
update_settings({
  action: "configure_github",
  github: {
    labels: {
      typeMappings: {
        FEATURE: "type: feature",
        BUG: "type: bug"
      }
    }
  }
})
```

### Additional Labels

```typescript
update_settings({
  action: "configure_github",
  github: {
    labels: {
      customLabels: ["dev-workflow", "automated"]
    }
  }
})
```

## How Sync Works

### Task Activation

When you call `move_issue_to_backlog`:

1. For each PLANNED task:
   - Creates GitHub issue
   - Applies labels
   - Adds to Project
   - Moves to Backlog column

2. Parent issue transitions: PLANNED → OPEN

### Status Changes

| Status Change | GitHub Actions |
|---------------|----------------|
| Any → IN_PROGRESS | Move to "In Progress", auto-assign |
| Any → PR_REVIEW | Move to "In Review" |
| Any → COMPLETED | Close issue, move to "Done" |
| Any → ABANDONED | Close issue, move to "Done" |

### Issue Body

Synced issues include:
- Task description
- Acceptance criteria (checkboxes)
- Link to dev-workflow task

## Importing GitHub Issues

Import existing GitHub issues:

```typescript
import_github_issue({
  githubIssueNumber: 42
})
```

Or by URL:

```typescript
import_github_issue({
  githubIssueUrl: "https://github.com/owner/repo/issues/42"
})
```

This:
- Creates dev-workflow issue from GitHub issue
- Infers type/priority from labels
- Stores source issue reference

### Sub-Issues

After importing and generating a plan:

**Single task:** Links to parent issue (no new issue)

**Multiple tasks:** Creates sub-issues:
- Each task becomes a new GitHub issue
- Sub-issues linked to parent
- Parent tracks overall progress

## Repairing Sync State

If sync gets out of sync:

```typescript
sync_issue({
  issueNumber: 123
})
```

This:
- Creates missing GitHub issues
- Links existing issues by title
- Verifies linked issues exist
- Repairs project board state

Idempotent: safe to run multiple times.

## Troubleshooting

### "GitHub CLI not authenticated"

```bash
gh auth login
```

### "Not in a GitHub repository"

1. Check you're in a git repo
2. Verify GitHub remote: `git remote -v`

### "GitHub Project not found"

- Verify project ID format: `PVT_...`
- Check you have access
- Copy ID fresh from settings

### Task Not Moving Columns

1. Check task has `remoteProjectId`
2. Verify column names match
3. Run `sync_issue` to repair

### Labels Not Created

- dev-workflow creates labels on first use
- Check repo write permissions
- Labels use lowercase by default

## Best Practices

1. **Enable Projects** - Kanban boards give team visibility

2. **Use consistent column names** - Or configure mapping

3. **Don't edit synced issues on GitHub** - dev-workflow is source of truth

4. **Import before planning** - Import GitHub issues before creating plans

5. **Check sync after errors** - Run `sync_issue` if operations fail

## Next Steps

- [Use milestones for planning](/user-guide/milestones)
- [Track history with snapshots](/user-guide/snapshots)
- [View work in the web UI](/user-guide/web-ui)

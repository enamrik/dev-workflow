# Configuration Guide

> This guide is part of the [dev-workflow documentation](../README.md).

This guide covers all configuration options for dev-workflow: directory structure, templates, custom types, hooks, and GitHub integration settings.

## Directory Structure

dev-workflow uses two locations for configuration:

### Local Project Configuration (`.track/`)

Located in your project's root directory. Checked into version control for team sharing.

```
.track/
├── templates/
│   ├── issues/           # Issue templates
│   │   ├── feature.md
│   │   ├── bug.md
│   │   ├── enhancement.md
│   │   └── task.md
│   └── tasks/            # Task templates
│       ├── feature.md
│       ├── bug.md
│       └── all.md        # Fallback template
├── types.md              # Custom type definitions
└── hooks/                # Task lifecycle hooks (future)
    └── unit-tests.yml
```

### Global Configuration (`~/.dwf/track/`)

Located in your home directory. Stores the database and fallback configurations.

```
~/.dwf/track/
├── workflow.db           # Single database for all projects
├── config/
│   └── templates/        # Global fallback templates
│       ├── issues/
│       └── tasks/
└── <project-id>/         # Per-project data
    └── worktrees/        # Git worktrees for isolated tasks
```

The `DWF_HOME` environment variable can override the `~/.dwf/track/` location (useful for testing).

## Templates

Templates define the structure and default values for new issues and tasks.

### Template Format

Templates use Markdown with YAML frontmatter:

```markdown
---
type: FEATURE
priority: MEDIUM
labels: []
---

# Feature: [Title]

## Description

[Brief description of the feature]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Context

[Additional context or background]
```

### Frontmatter Fields

| Field      | Type   | Description                                                 |
| ---------- | ------ | ----------------------------------------------------------- |
| `type`     | string | Default issue type (FEATURE, BUG, ENHANCEMENT, TASK, SPIKE) |
| `priority` | string | Default priority (LOW, MEDIUM, HIGH, CRITICAL)              |
| `labels`   | array  | Default labels to apply                                     |

### Template Resolution Order

Templates are resolved in this order (first match wins):

1. **Local per-type**: `./.track/templates/issues/<type>.md`
2. **Local all.md**: `./.track/templates/issues/all.md`
3. **Global per-type**: `~/.dwf/track/config/templates/issues/<type>.md`
4. **Global all.md**: `~/.dwf/track/config/templates/issues/all.md`

The same pattern applies for task templates in the `tasks/` subdirectory.

### Managing Templates via MCP

| Tool              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `list_templates`  | List available templates (category: "issue" or "task") |
| `get_template`    | Get a specific template with source info               |
| `create_template` | Create a new local template                            |
| `update_template` | Update an existing local template                      |
| `delete_template` | Delete a local template                                |

### Template Selection

When creating an issue with `useTemplate: true`, the system analyzes the description to select the appropriate template:

- Keywords like "bug", "error", "broken" → `bug.md`
- Keywords like "enhance", "improve", "optimize" → `enhancement.md`
- Keywords like "task", "chore", "setup" → `task.md`
- Default → `feature.md`

If a TypeDomainService is configured via `.track/types.md`, it uses the custom type descriptions for smarter matching.

## Custom Types

Define custom issue/task types in `.track/types.md`:

```markdown
## FEATURE -> feature

New functionality that doesn't exist yet. Something the user can do that they couldn't before.

## BUG -> bug

Something is broken or not working as expected. Error states, crashes, incorrect behavior.

## ENHANCEMENT -> enhancement

Improvements to existing functionality. Performance, UX, code quality improvements.

## TASK -> task

Maintenance work, chores, setup, documentation. Non-feature work.

## SPIKE -> spike

Time-boxed research or exploration. Investigation before committing to implementation.
```

### Format

Each type definition has:

- Header: `## TYPE_NAME -> remote-label`
  - `TYPE_NAME`: Uppercase name (FEATURE, BUG, ENHANCEMENT, TASK, SPIKE)
  - `remote-label`: Optional label for GitHub sync (defaults to lowercase type name)
- Description: Paragraph(s) explaining when to use this type

### Keywords

The TypeDomainService automatically extracts keywords from descriptions for intelligent type selection. Words 4+ characters (excluding common stop words) become keywords.

### Viewing Types

Use `list_types` to see all available types with their remote label mappings:

```
list_types
```

Returns:

```json
{
  "types": [
    { "name": "FEATURE", "description": "...", "remoteLabel": "feature" },
    { "name": "BUG", "description": "...", "remoteLabel": "bug" },
    { "name": "SPIKE", "description": "...", "remoteLabel": "spike" }
  ]
}
```

## Task Lifecycle Hooks

Hooks allow running scripts at specific points in the task lifecycle.

### Hook Stages

| Stage          | When                           | Must Pass? |
| -------------- | ------------------------------ | ---------- |
| `preStart`     | Before task enters IN_PROGRESS | Yes        |
| `postStart`    | After task enters IN_PROGRESS  | No         |
| `preComplete`  | Before task enters COMPLETED   | Yes        |
| `postComplete` | After task enters COMPLETED    | No         |
| `onAbandon`    | When task is abandoned         | No         |

### Hook Configuration

Create YAML files in `.track/hooks/`:

```yaml
# .track/hooks/unit-tests.yml
preComplete:
  - command: "pnpm test"
    description: "Run unit tests"
    mustPass: true
```

```yaml
# .track/hooks/e2e-tests.yml
preComplete:
  - command: "pnpm test:e2e"
    description: "Run e2e tests"
    mustPass: true
```

### Composable Hooks

Tasks can reference multiple hook configurations:

```typescript
{
  hookConfigLabels: ["unit-tests", "e2e-tests", "security"];
}
```

Hooks from multiple labels are merged and executed in label order. First failure (for `mustPass` hooks) stops execution.

See [ADR-002: Hook Composition](adr/002-hook-composition.md) for design rationale.

## GitHub Integration Settings

Configure GitHub sync via the `update_settings` MCP tool.

### Enabling GitHub Sync

```
update_settings
  action: "enable_github"
  github:
    projectId: "PVT_..."  # Optional GitHub Projects ID
    assignee: "username"   # Optional auto-assignee
```

The system auto-detects repository owner/repo from git remotes.

### Configuration Options

| Setting               | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `projectId`           | GitHub Project ID (format: `PVT_...`) for board integration       |
| `assignee`            | GitHub username to auto-assign when task enters IN_PROGRESS       |
| `labels.typeMappings` | Map type names to GitHub labels (required type-to-label mappings) |
| `labels.customLabels` | Additional labels for all synced issues                           |
| `columnMapping`       | Map task statuses to project board columns                        |

### Column Mapping

Customize which project board columns map to task statuses:

```
update_settings
  action: "configure_column_mapping"
  github:
    columnMapping:
      BACKLOG: "To Do"
      READY: "Ready"
      IN_PROGRESS: "In Progress"
      PR_REVIEW: "In Review"
      COMPLETED: "Done"
      ABANDONED: "Done"
```

### Default Column Mapping

| Task Status | Default Column |
| ----------- | -------------- |
| BACKLOG     | Backlog        |
| READY       | Ready          |
| IN_PROGRESS | In Progress    |
| PR_REVIEW   | In Review      |
| COMPLETED   | Done           |
| ABANDONED   | Done           |

### Type Mappings

Customize how internal issue/task types map to GitHub labels. These are required mappings that determine which label is applied based on the type:

```
update_settings
  action: "configure_github"
  github:
    labels:
      typeMappings:
        FEATURE: "type: feature"
        BUG: "type: bug"
        ENHANCEMENT: "type: enhancement"
        TASK: "type: task"
      customLabels: ["dev-workflow"]
```

> **Note:** `typeMappings` are required type-to-label mappings. `customLabels` are optional additional labels applied to all synced issues regardless of type.

### Viewing Settings

```
update_settings
  action: "get_settings"
```

Returns current configuration including:

- Project info (ID, name, git root)
- Available providers (GitHub, etc.)
- GitHub sync config (if enabled)
- Column mapping (effective and custom)
- gh CLI authentication status

### Disabling GitHub Sync

```
update_settings
  action: "disable_github"
```

Preserves configuration but disables syncing. Re-enable with `enable_github`.

## Project Identification

Projects are identified by a stable ID derived from:

- Repository folder name
- First (initial) commit hash (6 characters)

Example: `dev-workflow-b9bccf`

This ensures the ID:

- Never changes (first commit is immutable)
- Works without remotes
- Is human-readable

## Environment Variables

| Variable   | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `DWF_HOME` | Override the global track directory (default: `~/.dwf/track/`) |

## MCP Tools Reference

### Template Management

| Tool              | Description                             |
| ----------------- | --------------------------------------- |
| `list_templates`  | List templates (issue or task category) |
| `get_template`    | Get template content with source info   |
| `create_template` | Create a new local template             |
| `update_template` | Update a local template                 |
| `delete_template` | Delete a local template                 |

### Type Management

| Tool         | Description                                        |
| ------------ | -------------------------------------------------- |
| `list_types` | List all types with descriptions and remote labels |

### Settings Management

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `update_settings` | Manage project settings (get/enable/disable/configure GitHub) |

For detailed tool parameters, see the [MCP Tools Reference](MCP_TOOLS.md).

## Best Practices

1. **Commit `.track/` to version control**: Share templates and type definitions with your team
2. **Use type-specific templates**: Create `bug.md`, `feature.md`, etc. for different issue types
3. **Define meaningful types**: Custom descriptions in `types.md` improve auto-selection
4. **Map columns to your workflow**: Customize column mapping to match your project board
5. **Use hooks for quality gates**: Run tests before completing tasks via preComplete hooks

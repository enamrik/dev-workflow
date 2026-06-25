---
sidebar_position: 3
---

# Configuration

Configure dev-workflow through templates, settings, and types.

## Directory Structure

```
.track/                       # Project track directory
├── workflow.db               # SQLite database
├── templates/                # Project-local templates
│   ├── issue/
│   └── task/
└── worktrees/                # Git worktrees for tasks

~/.track/                     # Global track directory
├── workflow.db               # Global database
└── templates/                # Global templates
    ├── issue/
    └── task/

.claude/                      # Claude Code configuration
├── skills/                   # Claude skills
│   └── dwf-*/
└── settings.json             # Claude settings
```

## Templates

Templates define default content for new issues and tasks.

### Template Format

Templates use Markdown with YAML frontmatter:

```markdown
---
type: FEATURE
priority: MEDIUM
---

# Feature: {title}

## Description

{description}

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Technical Notes

Add any technical considerations here.
```

### Template Locations

| Scope | Location | Priority |
|-------|----------|----------|
| Local | `.track/templates/` | Higher |
| Global | `~/.track/templates/` | Lower |

Local templates override global templates with the same filename.

### Creating Templates

```typescript
create_template({
  filename: "api-feature.md",
  content: `---
type: FEATURE
priority: HIGH
---

# API Feature: {title}

## Endpoints

| Method | Path | Description |
|--------|------|-------------|

## Request/Response

## Error Handling
`,
  scope: "local",
  category: "issue"
})
```

### Default Templates

dev-workflow includes default templates for:
- `feature.md` - New features
- `bug.md` - Bug reports
- `enhancement.md` - Improvements
- `task.md` - Generic tasks

### Template Variables

| Variable | Replaced With |
|----------|---------------|
| `{title}` | Issue title |
| `{description}` | Issue description |

## Custom Types

### Default Types

| Type | Description |
|------|-------------|
| FEATURE | New functionality |
| BUG | Something broken |
| ENHANCEMENT | Improvement to existing |
| TASK | Generic work item |

### Creating Custom Types

```typescript
create_type({
  name: "EPIC",
  displayName: "Epic",
  description: "Large feature spanning multiple issues",
  keywords: ["epic", "large", "umbrella", "parent"],
  color: "#9b59b6"
})
```

### Type Properties

| Property | Description |
|----------|-------------|
| `name` | Uppercase identifier (e.g., "EPIC") |
| `displayName` | Human-readable name |
| `description` | When to use this type |
| `keywords` | Help Claude select type |
| `color` | UI color (hex) |

### Type Keywords

Keywords help Claude automatically select the right type:

```typescript
create_type({
  name: "TECH_DEBT",
  displayName: "Tech Debt",
  description: "Technical debt reduction",
  keywords: ["debt", "refactor", "cleanup", "technical", "legacy"]
})
```

## GitHub Settings

### Enabling GitHub Sync

```typescript
update_settings({
  action: "enable_github",
  github: {
    projectId: "PVT_...",     // GitHub Project ID
    assignee: "username"       // Auto-assign on IN_PROGRESS
  }
})
```

### Configuring Labels

```typescript
update_settings({
  action: "configure_github",
  github: {
    labels: {
      typeMappings: {
        FEATURE: "type: feature",
        BUG: "type: bug",
        EPIC: "type: epic"
      },
      customLabels: ["dev-workflow"]
    }
  }
})
```

### Column Mapping

```typescript
update_settings({
  action: "configure_column_mapping",
  github: {
    columnMapping: {
      READY: "To Do",
      PR_REVIEW: "Code Review",
      COMPLETED: "Done"
    }
  }
})
```

### Checking Settings

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRACK_DIR` | Track directory location | `~/.track` or `.track` |
| `DATABASE_PATH` | Database path | `{TRACK_DIR}/workflow.db` |
| `PORT` | Web UI port | `3000` |

## Claude Settings

### MCP Server Registration

The MCP server is registered in `~/.claude.json`:

```json
{
  "mcpServers": {
    "dev-workflow-tracker": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/dev-workflow/dist/main.js", "mcp"],
      "env": {
        "PROJECT_SLUG": "project-id",
        "GIT_ROOT": "/path/to/project"
      }
    }
  }
}
```

### Claude Skills

Skills are installed to `.claude/skills/`:

| Skill | Description |
|-------|-------------|
| `dwf-work-request` | Entry point for new work |
| `dwf-manage-issue` | Issue CRUD operations |
| `dwf-plan-issue` | Generate implementation plans |
| `dwf-work-task` | Task execution lifecycle |
| `dwf-worker-task` | Worker task execution |
| `dwf-configure-github` | GitHub integration setup |
| `dwf-manage-milestone` | Milestone management |

## Best Practices

### Template Organization

1. **Use local templates for project-specific formats**
2. **Use global templates for personal defaults**
3. **Include all required sections in templates**
4. **Keep templates focused and concise**

### Type Management

1. **Create types that reflect your workflow**
2. **Use descriptive keywords**
3. **Assign distinct colors for quick identification**
4. **Keep type names short and uppercase**

### GitHub Configuration

1. **Use project boards for visibility**
2. **Configure labels to match team conventions**
3. **Set auto-assign for task tracking**
4. **Use column mapping for custom boards**

## Next Steps

- [Claude Skills Reference](/reference/claude-skills)
- [Troubleshooting](/advanced/troubleshooting)

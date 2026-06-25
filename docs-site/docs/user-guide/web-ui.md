---
sidebar_position: 7
---

# Web UI

dev-workflow includes a web-based UI for visualizing and managing your work across projects.

## Starting the UI

```bash
dev-workflow ui
```

Opens the web UI at http://localhost:3000

### Auto-Start with PM2

Install as a background service:

```bash
dev-workflow ui:install
```

Remove the service:

```bash
dev-workflow ui:uninstall
```

## Features

### Project Overview

The dashboard shows all projects tracked by dev-workflow:
- Project name and path
- Issue counts by status
- Recent activity

### Kanban Board

Each project has a kanban board showing:
- Issues as cards
- Status columns (Planned, Open, In Progress, Closed)
- Task progress indicators

#### Filtering

- Filter by milestone
- Filter by type
- Search by title/description

### Issue Detail

Click an issue to see:
- Full description
- Acceptance criteria
- Plan with tasks
- Task status indicators
- Action buttons

### Task Status

Tasks show their current status:
- 🔵 PLANNED - Not yet activated
- ⬜ BACKLOG - Available but not started
- 🟡 READY - Dependencies met
- 🟢 IN_PROGRESS - Being worked on
- 🟣 PR_REVIEW - Awaiting review
- ✅ COMPLETED - Done
- ❌ ABANDONED - Cancelled

## Multi-Project Support

The web UI shows all projects in your track directory:
- Switch between projects in the sidebar
- Each project has its own board
- Shared database, separate views

## Settings

Access project settings from the UI:
- GitHub integration status
- Column mapping
- Label configuration

## Best Practices

1. **Keep the UI running** - Install as PM2 service for always-on access

2. **Use alongside CLI** - UI is read-heavy, Claude handles mutations

3. **Share with team** - Team members can view progress without Claude access

4. **Filter effectively** - Use milestones and filters to focus

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill it or use different port
PORT=3001 dev-workflow ui
```

### No Projects Showing

- Run `dev-workflow init` in at least one project
- Check `~/.track/workflow.db` exists

### Stale Data

The UI auto-refreshes, but you can manually refresh:
- Ctrl+R / Cmd+R to reload
- Or click the refresh button

## Next Steps

- [CLI Commands Reference](/reference/cli-commands)
- [MCP Tools Reference](/reference/mcp-tools)

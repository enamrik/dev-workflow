# Web UI Guide

> This guide is part of the [dev-workflow documentation](../README.md).

The dev-workflow includes a web interface for visualizing issues, plans, tasks, milestones, workers, and worktrees. It provides real-time updates via WebSocket and supports multi-project views.

## Starting the Web UI

From a project with dev-workflow initialized:

```bash
dwf ui
```

The server will:

1. Find an available port (starting at 3500)
2. Start a Next.js server
3. Open your default browser automatically
4. Display the URL in the terminal

## Pages Overview

| Page         | Route                                 | Description                                     |
| ------------ | ------------------------------------- | ----------------------------------------------- |
| Task Board   | `/`                                   | Kanban board showing all tasks by status        |
| Issues       | `/issues`                             | Searchable list of all issues                   |
| Issue Detail | `/projects/[project]/issues/[number]` | Full issue with plan and tasks                  |
| Milestones   | `/milestones`                         | Timeline view of milestones                     |
| Workers      | `/workers`                            | Background worker status and dispatch queue     |
| Worktrees    | `/worktrees`                          | Git worktree management                         |
| Settings     | `/settings`                           | Project configuration (GitHub sync, datasource) |

## Task Board (`/`)

The home page displays a Kanban board with tasks organized by status:

### Columns

| Column      | Task Status         | Description                                                          |
| ----------- | ------------------- | -------------------------------------------------------------------- |
| Backlog     | BACKLOG             | Tasks refined and awaiting prioritization (hidden by default)        |
| Planned     | PLANNED             | Tasks in planned issues not yet moved to backlog (hidden by default) |
| Ready       | READY               | Tasks ready to be picked up                                          |
| In Progress | IN_PROGRESS         | Tasks currently being worked on                                      |
| In Review   | PR_REVIEW           | Tasks with open PRs awaiting review                                  |
| Done        | COMPLETED/ABANDONED | Recently completed tasks (last 7 days, max 20)                       |

### Task Cards

Each task card displays:

- Task number and title
- Parent issue reference (e.g., `#5.1`)
- Type badge (from parent issue)
- Worker ID (if assigned to a background worker)
- GitHub link (if synced)

### Options Menu

Click the filter icon to toggle:

- **Show backlog/planned**: Display the Backlog and Planned columns
- **Show work queue**: Display a ribbon showing issues ready for work

### Work Queue Ribbon

When enabled, shows a horizontal strip of issues that have tasks ready to work on. Click an issue to open a preview panel with quick navigation.

## Issues List (`/issues`)

Displays all issues with filtering and search capabilities.

### Features

- **Search**: Filter by title or description
- **Show closed**: Toggle to include/exclude closed issues
- **Pagination**: Navigate through large issue lists

### Issue Table Columns

| Column   | Description                                             |
| -------- | ------------------------------------------------------- |
| Issue    | Number, title, and type badge                           |
| Priority | LOW, MEDIUM, HIGH, or CRITICAL                          |
| Status   | Computed status (OPEN, IN_PROGRESS, TASKS_DONE, CLOSED) |
| Progress | Task completion bar showing X/Y tasks done              |
| GitHub   | Link to GitHub issue (if synced)                        |

### Computed Status

Issue status is computed from task states:

| Status      | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| OPEN        | No tasks in progress (plan may exist but work hasn't started) |
| IN_PROGRESS | At least one task is IN_PROGRESS or PR_REVIEW                 |
| TASKS_DONE  | All tasks are COMPLETED or ABANDONED                          |
| CLOSED      | Issue explicitly closed                                       |

## Issue Detail (`/projects/[project]/issues/[number]`)

Click any issue to view its full details. The page has three tabs:

### Details Tab

- Full description (rendered as Markdown)
- Acceptance criteria checklist
- Labels
- Creation and update timestamps
- GitHub link (if synced)

### Plan Tab

If an implementation plan exists:

- Complexity badge (LOW, MEDIUM, HIGH, VERY_HIGH)
- Plan summary
- Technical approach (rendered as Markdown)
- Plan generation timestamp

### Tasks Tab

- Progress bar showing completion status
- Task list with expandable cards
- Each task shows:
  - Number, title, and type
  - Status badge
  - Description
  - Acceptance criteria
  - Implementation plan (technical details)
  - Dependencies
  - GitHub link (if synced)
  - Estimated time
  - Worker assignment

### Task Modal

Click a task to open a detailed modal with:

- Full task description
- Implementation plan (not synced to GitHub - internal technical notes)
- Acceptance criteria
- Execution log (if task has been worked on)
- Status transitions and timestamps

## Milestones (`/milestones`)

Visual timeline of project milestones.

### Timeline View

Milestones are displayed on a horizontal timeline showing:

- Date range visualization
- Status indicator (color-coded)
- Issue count and progress
- Start and end dates

### Status Colors

| Status      | Color      | Meaning                              |
| ----------- | ---------- | ------------------------------------ |
| PLANNED     | Gray       | No work started                      |
| IN_PROGRESS | Blue       | Work underway                        |
| DELAYED     | Orange/Red | Past end date with incomplete issues |
| COMPLETED   | Green      | Manually signed off                  |

### Options

- **Show completed milestones**: Toggle to include/exclude completed milestones

## Workers (`/workers`)

Monitor background task workers and the dispatch queue.

### Worker Section

Shows registered Claude worker processes:

- Worker name and status (IDLE, WORKING, DRAINING)
- Current task assignment (if working)
- Running duration or last heartbeat
- Dead worker detection (no heartbeat)

### Dispatch Queue Section

Shows tasks waiting for or being worked by workers:

- Task identifier and title
- Queue status (WAITING, CLAIMED, STALE)
- Worker assignment (if claimed)
- Queue and claim timestamps

### Stats Summary

| Stat        | Description                               |
| ----------- | ----------------------------------------- |
| Total Queue | Total tasks in dispatch queue             |
| Unclaimed   | Tasks waiting for a worker                |
| In Progress | Tasks actively being worked               |
| Stale       | Claimed by dead workers (needs attention) |

Updates automatically via WebSocket for real-time monitoring.

## Worktrees (`/worktrees`)

Manage git worktrees created for isolated task execution.

### Summary Stats

- **Total Worktrees**: Count of active worktrees
- **Total Disk Usage**: Combined size of all worktrees
- **Orphaned**: Worktrees not linked to an active task

### Worktree Cards

Each worktree shows:

- Branch name
- Path (abbreviated)
- Linked task (issue and task number)
- Task status badge
- Disk usage
- Commit SHA (abbreviated)

### Prune Stale

Click "Prune Stale" to clean up worktrees that are no longer linked to the filesystem. This removes orphaned git worktree references.

## Settings (`/settings`)

View project configuration (read-only in the UI).

### Project Management Provider

If GitHub sync is enabled:

- Provider name (GitHub)
- Sync status (Enabled/Disabled)
- Repository URL (linked)
- Project Board ID and URL (if configured)

If not configured:

- Message indicating local-only management

### Datasource

- Project name and slug
- Git root path
- Source type (local/global)
- Database path

## Multi-Project Support

The Web UI supports viewing multiple projects:

### Project Selector

A dropdown in the navigation allows switching between projects. The UI automatically discovers all projects from:

- The global database (`~/.track/workflow.db`)
- Projects with initialized `.track/` directories

### URL State

Project selection and filters are persisted in the URL, enabling:

- Direct linking to filtered views
- Browser history navigation
- Bookmark support

## Real-Time Updates

The Web UI uses WebSocket connections for live updates:

- Task status changes appear immediately
- Worker heartbeats update in real-time
- Queue changes reflect instantly
- No manual refresh needed

A manual refresh button is available on pages that support it.

## Architecture

The web UI is built with:

- **Next.js 15**: React framework with App Router
- **React Query**: Data fetching and caching
- **Tailwind CSS**: Utility-first styling
- **WebSocket**: Real-time updates

### Package Structure

```
apps/web/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── page.tsx      # Task board (/)
│   │   ├── issues/       # Issues list
│   │   ├── projects/     # Issue detail
│   │   ├── milestones/   # Milestones timeline
│   │   ├── workers/      # Workers status
│   │   ├── worktrees/    # Worktree management
│   │   ├── settings/     # Project settings
│   │   └── api/          # API routes
│   ├── components/       # React components
│   ├── contexts/         # React contexts
│   ├── hooks/            # Custom hooks
│   └── lib/              # Utilities and types
└── public/               # Static assets
```

## Notes

- The server runs locally only (`127.0.0.1`)
- Port is dynamically assigned to avoid conflicts
- No authentication (local development tool)
- Read-only interface (changes made via Claude/MCP tools)
- Supports worktree isolation (unique ports per task)

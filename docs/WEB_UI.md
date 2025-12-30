# Web UI Guide

The dev-workflow includes a web interface for visualizing issues, plans, and tasks.

## Starting the Web UI

From a project with dev-workflow initialized:

```bash
dev-workflow ui
```

The server will:
1. Find an available port (between 3000-9000)
2. Start a Fastify server
3. Open your default browser automatically
4. Display the URL in the terminal

## Features

### Issues List (`/`)

The home page displays all issues with:
- Issue number and title
- Type badge (FEATURE, BUG, ENHANCEMENT, TASK)
- Priority indicator
- Status (OPEN, IN_PROGRESS, CLOSED)
- Whether a plan exists
- Task completion progress

Click any issue to view details.

### Issue Detail (`/issues/:number`)

View complete issue information:
- Full description
- Acceptance criteria checklist
- Labels
- Implementation plan (if exists)
  - Summary and approach
  - Complexity estimate
- Task list with status indicators

### Kanban Board (`/kanban`)

Visual task board organized by status columns:
- **PENDING** - Tasks not yet started
- **IN_PROGRESS** - Tasks currently being worked on
- **COMPLETED** - Finished tasks
- **ABANDONED** - Tasks that were abandoned

Tasks are grouped by their parent issue for context.

## Architecture

The web UI is built with:
- **Fastify** - Fast, low-overhead web framework
- **Server-side HTML** - No client-side JavaScript framework
- **Static CSS** - Simple, responsive styles

### File Structure

```
packages/cli/src/ui/
├── server.ts           # Fastify server setup
├── routes/
│   ├── index.route.ts  # HTML page routes
│   └── api.route.ts    # JSON API routes
├── templates/
│   ├── layout.ts       # Base HTML layout
│   ├── issues-list.ts  # Issues list page
│   ├── issue-detail.ts # Issue detail page
│   └── kanban-board.ts # Kanban board page
└── public/
    └── styles/
        └── main.css    # Stylesheet
```

## API Endpoints

The UI includes JSON API endpoints for programmatic access:

### List Issues

```
GET /api/issues
GET /api/issues?status=OPEN
GET /api/issues?type=BUG
GET /api/issues?priority=HIGH
```

Returns array of issues with optional filtering.

## Notes

- The server runs locally only (`127.0.0.1`)
- Port is dynamically assigned to avoid conflicts
- No authentication (local development tool)
- Read-only interface (changes made via Claude/MCP tools)

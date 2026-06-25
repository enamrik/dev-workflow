---
slug: /
sidebar_position: 1
---

# Welcome to dev-workflow

**dev-workflow** is an AI-driven development workflow system that helps you manage issues, plans, and tasks with Claude AI integration.

## What is dev-workflow?

dev-workflow provides a structured approach to software development where:

- **Issues** represent work to be done (features, bugs, enhancements)
- **Plans** break down issues into actionable tasks with dependencies
- **Tasks** are executed by Claude AI or human developers
- **GitHub Integration** syncs your work with GitHub Issues and Projects

## Key Features

### Issue Tracking
Create and manage issues with rich metadata including types, priorities, acceptance criteria, and milestone assignments.

### AI-Powered Planning
Claude AI generates implementation plans with properly-scoped tasks, dependencies, and acceptance criteria.

### Task Execution
Work on tasks in isolated git worktrees with automatic PR creation and GitHub sync.

### Multi-Project Support
Track multiple projects from a single database with a beautiful web UI.

### Version History
Full snapshot history with time-travel capabilities to view or revert to any previous state.

## Quick Example

```bash
# Initialize dev-workflow in your project
dev-workflow init

# Create an issue using Claude
# Claude will invoke the MCP tools automatically
"Add user authentication to the API"

# Generate an implementation plan
# Claude breaks it down into tasks
"/plan-issue"

# Work on tasks
# Claude creates PRs and manages the workflow
"/work-task"
```

## Getting Started

Ready to get started? Head to the [Installation Guide](/getting-started/installation) to set up dev-workflow in your project.

## Architecture

dev-workflow uses the Model Context Protocol (MCP) to provide Claude with 55 specialized tools for issue tracking, planning, and task execution. The system stores data in SQLite locally and can sync with GitHub for team collaboration.

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
│                    (or Claude CLI)                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server                                │
│              55 Tools for Workflow Management                │
└──────┬────────────────────────────────────┬─────────────────┘
       │                                    │
       ▼                                    ▼
┌──────────────┐                    ┌──────────────────┐
│   SQLite DB  │                    │   GitHub API     │
│  (Local)     │                    │   (Optional)     │
└──────────────┘                    └──────────────────┘
```

## Community

- **GitHub**: Report issues and contribute at [github.com/your-org/dev-workflow](https://github.com/your-org/dev-workflow)
- **Discussions**: Ask questions and share ideas in GitHub Discussions

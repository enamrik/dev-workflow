# Task Execution Guide

> This guide is part of the [dev-workflow documentation](../README.md).

Guide to task execution modes, lifecycle, and PR workflow.

_Documentation coming soon - see [Issue #162](https://github.com/enamrik/dev-workflow/issues/162) for progress._

## Execution Modes

- **Isolated** (default) - Creates git worktree + branch for parallel work
- **Branch** - Creates branch only, works in main repo
- **Main** - Works directly on main branch, skips PR workflow

## Task Lifecycle

PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED

# MCP Tools Reference

> This guide is part of the [dev-workflow documentation](../README.md).

Comprehensive reference for all 53 MCP tools available via the Model Context Protocol. These tools enable Claude to manage the complete development workflow.

## Table of Contents

- [Issue Management](#issue-management) (17 tools)
- [Planning](#planning) (6 tools)
- [Task Execution](#task-execution) (10 tools)
- [PR Workflow](#pr-workflow) (4 tools)
- [Milestones](#milestones) (7 tools)
- [Snapshots](#snapshots) (3 tools)
- [Settings](#settings) (1 tool, 6 actions)
- [Worktrees](#worktrees) (2 tools)
- [Merge](#merge) (1 tool)
- [Types](#types) (1 tool)
- [Dispatch](#dispatch) (2 tools)

---

## Issue Management

### create_issue

Creates a new issue in the task tracker.

| Parameter            | Type     | Required | Description                                                                   |
| -------------------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `title`              | string   | Yes      | Issue title                                                                   |
| `description`        | string   | Yes      | Detailed description of the issue                                             |
| `acceptanceCriteria` | string[] | No       | List of acceptance criteria                                                   |
| `type`               | enum     | No       | Issue type: `FEATURE`, `BUG`, `ENHANCEMENT`, `TASK`                           |
| `priority`           | enum     | No       | Priority: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`                                 |
| `useTemplate`        | boolean  | No       | Auto-select template based on description                                     |
| `labels`             | object   | No       | Labels as key-value pairs. Example: `{"bug": "", "product": "Case Workflow"}` |

**Returns:** Created issue with `id`, `number`, `status`, `url`, etc.

**Example:**

```json
{
  "title": "Add user authentication",
  "description": "Implement OAuth2 login flow",
  "type": "FEATURE",
  "priority": "HIGH"
}
```

---

### get_issue

Get issue details by ID or number.

| Parameter     | Type    | Required | Description                                           |
| ------------- | ------- | -------- | ----------------------------------------------------- |
| `id`          | string  | No       | Issue UUID                                            |
| `issueNumber` | number  | No       | Issue number (e.g., 123 for #123)                     |
| `includePlan` | boolean | No       | Include the plan with slim task list (default: false) |

**Returns:** Full issue data, optionally with plan and tasks.

---

### update_issue

Updates an issue's properties.

| Parameter        | Type    | Required | Description                                                                       |
| ---------------- | ------- | -------- | --------------------------------------------------------------------------------- |
| `issueId`        | string  | No       | Issue UUID                                                                        |
| `issueNumber`    | number  | No       | Issue number (alternative to issueId)                                             |
| `updates`        | object  | Yes      | Fields to update (title, description, acceptanceCriteria, type, priority, labels) |
| `regeneratePlan` | boolean | No       | Automatically regenerate plan after update (default: false)                       |

**Note:** Use `close_issue` to change status. This tool is for updating content.

---

### delete_issue

Soft delete an issue.

| Parameter     | Type   | Required | Description                           |
| ------------- | ------ | -------- | ------------------------------------- |
| `issueId`     | string | No       | Issue UUID                            |
| `issueNumber` | number | No       | Issue number (alternative to issueId) |

**Restrictions:** Only PLANNED issues can be deleted. Once work begins (status changes to OPEN or IN_PROGRESS), use `close_issue` instead.

**Side Effects:**

- Closes linked GitHub issues (if sync enabled)
- Cleans up worktrees and branches for all tasks

---

### restore_issue

Restore a soft-deleted issue.

| Parameter     | Type   | Required | Description                           |
| ------------- | ------ | -------- | ------------------------------------- |
| `issueId`     | string | No       | Issue UUID                            |
| `issueNumber` | number | No       | Issue number (alternative to issueId) |

**Returns:** Restored issue with accessible plans and tasks.

---

### close_issue

Close an issue after all tasks are complete.

| Parameter     | Type    | Required | Description                                         |
| ------------- | ------- | -------- | --------------------------------------------------- |
| `issueNumber` | number  | Yes      | Issue number                                        |
| `force`       | boolean | No       | Bypass task state validation when state has drifted |

**Validation:** All tasks must be in terminal state (COMPLETED or ABANDONED). Use `force=true` to bypass if work is actually done but tasks weren't marked complete.

**Side Effects:** Syncs to GitHub if the issue has a linked GitHub issue. For imported issues, also closes the parent GitHub issue.

---

### change_issue_type

Change an issue's type.

| Parameter     | Type   | Required | Description    |
| ------------- | ------ | -------- | -------------- |
| `issueNumber` | number | Yes      | Issue number   |
| `type`        | string | Yes      | New issue type |

**Validation:** Type is validated against available types from `./.track/types.md` or defaults (FEATURE, BUG, ENHANCEMENT, TASK).

---

### search_issues

Search issues by keyword.

| Parameter | Type   | Required | Description                     |
| --------- | ------ | -------- | ------------------------------- |
| `query`   | string | Yes      | Search query (case-insensitive) |

**Returns:** Slim results with number, title, status, type, priority. Maximum 10 results.

---

### get_project_stats

Get project statistics.

| Parameter | Type | Required | Description            |
| --------- | ---- | -------- | ---------------------- |
| (none)    | -    | -        | No parameters required |

**Returns:** Issue and task counts by status.

```json
{
  "issues": { "planned": 5, "open": 3, "inProgress": 2, "closed": 10, "total": 20 },
  "tasks": {
    "planned": 8,
    "backlog": 5,
    "ready": 3,
    "inProgress": 2,
    "prReview": 1,
    "completed": 15,
    "total": 34
  }
}
```

---

### get_work_queue

Get prioritized work queue.

| Parameter | Type | Required | Description            |
| --------- | ---- | -------- | ---------------------- |
| (none)    | -    | -        | No parameters required |

**Returns:**

- `needsPlanning`: Issues that need planning (PLANNED status without a plan)
- `issues`: Top 3 issues to work on
- `tasks`: Top 3 tasks to work on next

**Priority Scoring:** Considers status, priority, milestone deadlines, and task readiness.

---

### import_github_issue

Import an existing GitHub issue into dev-workflow.

| Parameter           | Type   | Required | Description                    |
| ------------------- | ------ | -------- | ------------------------------ |
| `githubIssueNumber` | number | No       | GitHub issue number (e.g., 42) |
| `githubIssueUrl`    | string | No       | GitHub issue URL (alternative) |

**Behavior:**

- Creates a dev-workflow issue from the GitHub issue's title and description
- Infers type and priority from GitHub labels
- Stores `sourceGitHubIssueNumber` to track the link
- Does NOT create tasks - use `generate_plan` after import
- Does NOT modify the original GitHub issue

---

### list_templates

List available templates.

| Parameter  | Type | Required | Description                 |
| ---------- | ---- | -------- | --------------------------- |
| `category` | enum | No       | `issue` (default) or `task` |

**Returns:** Array of templates with filename, type, priority, and source (user/default).

---

### get_template

Get a single template by filename.

| Parameter  | Type   | Required | Description                            |
| ---------- | ------ | -------- | -------------------------------------- |
| `filename` | string | Yes      | Template filename (e.g., 'feature.md') |
| `category` | enum   | No       | `issue` (default) or `task`            |

**Returns:** Template content, metadata, and source information.

---

### create_template

Create a new user-defined template.

| Parameter  | Type   | Required | Description                            |
| ---------- | ------ | -------- | -------------------------------------- |
| `filename` | string | Yes      | Template filename (must end with .md)  |
| `content`  | string | Yes      | Template content with YAML frontmatter |

**Example Content:**

```markdown
---
type: FEATURE
priority: MEDIUM
---

# Description

[Template body here]
```

---

### update_template

Update an existing user-defined template.

| Parameter  | Type   | Required | Description                                |
| ---------- | ------ | -------- | ------------------------------------------ |
| `filename` | string | Yes      | Template filename                          |
| `content`  | string | Yes      | New template content with YAML frontmatter |

**Note:** Cannot modify default templates. Create a user template with the same name to override.

---

### delete_template

Delete a user-defined template.

| Parameter  | Type   | Required | Description                 |
| ---------- | ------ | -------- | --------------------------- |
| `filename` | string | Yes      | Template filename to delete |

**Note:** Cannot delete default templates. If the user template was overriding a default, the default will become active again.

---

## Planning

### generate_plan

Generate or regenerate an implementation plan for an issue.

| Parameter             | Type   | Required | Description                                 |
| --------------------- | ------ | -------- | ------------------------------------------- |
| `issueId`             | string | No       | Issue UUID                                  |
| `issueNumber`         | number | No       | Issue number (alternative)                  |
| `summary`             | string | Yes      | Brief summary of the plan                   |
| `approach`            | string | Yes      | Detailed implementation approach (markdown) |
| `tasks`               | array  | Yes      | Array of task definitions                   |
| `estimatedComplexity` | enum   | Yes      | `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`        |

**Task Definition:**

| Field                | Type     | Required | Description                                                       |
| -------------------- | -------- | -------- | ----------------------------------------------------------------- |
| `id`                 | string   | Yes      | Short placeholder ID (e.g., 'db', 'api') for dependsOn references |
| `title`              | string   | Yes      | Task title                                                        |
| `description`        | string   | Yes      | Task description (human-readable, syncs to GitHub)                |
| `type`               | string   | Yes      | Task type - call `list_types` first for valid values              |
| `acceptanceCriteria` | string[] | No       | Acceptance criteria                                               |
| `estimatedMinutes`   | number   | No       | Time estimate                                                     |
| `dependsOn`          | string[] | No       | Array of placeholder IDs this task depends on                     |
| `implementationPlan` | string   | No       | Technical details for Claude (NOT synced to GitHub)               |

**Behavior:** Automatically preserves in-progress and completed tasks from previous plan when regenerating.

---

### get_plan

Get the active plan for an issue with tasks.

| Parameter     | Type   | Required | Description                |
| ------------- | ------ | -------- | -------------------------- |
| `issueId`     | string | No       | Issue UUID                 |
| `issueNumber` | number | No       | Issue number (alternative) |

**Returns:** Plan with summary, approach, complexity, and full task list.

---

### move_issue_to_backlog

Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG.

| Parameter        | Type    | Required | Description                                 |
| ---------------- | ------- | -------- | ------------------------------------------- |
| `issueNumber`    | number  | Yes      | Issue number                                |
| `skipGitHubSync` | boolean | No       | Skip GitHub issue creation (default: false) |

**Behavior:**

- Issue: PLANNED → OPEN
- Tasks: PLANNED → BACKLOG
- Creates GitHub issues for each task (unless `skipGitHubSync=true`)

This confirms the plan is finalized and makes tasks available for work.

---

### pause_issue

Pause work on an issue by moving all READY tasks back to BACKLOG.

| Parameter     | Type   | Required | Description  |
| ------------- | ------ | -------- | ------------ |
| `issueNumber` | number | Yes      | Issue number |

**Behavior:** Allows temporarily deactivating a plan. When work resumes (any task is started), BACKLOG tasks transition back to READY.

---

### move_issue_to_ready

Mark an issue as 'next up' by moving all BACKLOG tasks to READY.

| Parameter     | Type   | Required | Description  |
| ------------- | ------ | -------- | ------------ |
| `issueNumber` | number | Yes      | Issue number |

**Behavior:** Idempotent - does nothing if tasks are not in BACKLOG state. Syncs each task's READY status to GitHub Project board.

---

### sync_issue

Repair GitHub sync state for an issue.

| Parameter     | Type   | Required | Description  |
| ------------- | ------ | -------- | ------------ |
| `issueNumber` | number | Yes      | Issue number |

**Behavior:**

- Creates missing GitHub issues for tasks
- Links existing GitHub issues found by title search
- Verifies already-synced tasks still exist on GitHub

**Use Case:** Recover from partial syncs or errors during `move_issue_to_backlog`.

---

## Task Execution

### load_task_session

Load a task for execution with full context.

| Parameter   | Type   | Required | Description                                                        |
| ----------- | ------ | -------- | ------------------------------------------------------------------ |
| `taskId`    | string | Yes      | Task UUID                                                          |
| `sessionId` | string | Yes      | Claude session ID                                                  |
| `workerId`  | string | No       | Worker UUID (required for workers, used for task queue validation) |

**Behavior:** Creates a git worktree and branch for isolated parallel work.

**Returns:** Full context including task, issue, plan, worktree info, dependencies, and task requirements.

**Behavior:** Idempotent - if task is already IN_PROGRESS, returns context without restarting.

---

### abandon_task

Abandon the current task.

| Parameter   | Type    | Required | Description                         |
| ----------- | ------- | -------- | ----------------------------------- |
| `taskId`    | string  | Yes      | Task UUID                           |
| `sessionId` | string  | Yes      | Claude session ID                   |
| `reason`    | string  | No       | Reason for abandonment              |
| `force`     | boolean | No       | Bypass session ownership validation |

**Behavior:** Marks task as ABANDONED. Cleans up worktree and branch.

---

### get_task

Get task details by ID or number.

| Parameter     | Type   | Required | Description                                   |
| ------------- | ------ | -------- | --------------------------------------------- |
| `taskId`      | string | No       | Task UUID                                     |
| `taskNumber`  | number | No       | Task number within the issue (e.g., 1, 2, 3)  |
| `issueNumber` | number | No       | Issue number (required when using taskNumber) |

**Returns:** Task data only - use `load_task_session` for full execution context.

---

### list_available_tasks

List tasks available to work on.

| Parameter     | Type   | Required | Description            |
| ------------- | ------ | -------- | ---------------------- |
| `planId`      | string | No       | Filter by plan UUID    |
| `issueNumber` | number | No       | Filter by issue number |

**Returns:** Tasks in BACKLOG or READY status, not locked by another session.

---

### delete_task

Soft delete a task.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `taskId`  | string | Yes      | Task UUID   |

**Restrictions:** Only PLANNED tasks can be deleted. Once an issue moves to BACKLOG, task numbers become immutable. Use `abandon_task` for tasks past PLANNED status.

---

### update_task

Update a task's properties.

| Parameter            | Type     | Required | Description                                              |
| -------------------- | -------- | -------- | -------------------------------------------------------- |
| `taskId`             | string   | Yes      | Task UUID                                                |
| `title`              | string   | No       | New task title                                           |
| `description`        | string   | No       | New task description                                     |
| `acceptanceCriteria` | string[] | No       | New acceptance criteria                                  |
| `implementationPlan` | string   | No       | Technical implementation details                         |
| `estimatedMinutes`   | number   | No       | Estimated time in minutes                                |
| `labels`             | object   | No       | Labels as key-value pairs. `null` value removes a label. |

**Labels Example:**

```json
{ "urgent": "", "product": "Case Workflow" }
```

---

### get_task_execution_prompt

Generate a prompt for executing a task.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `taskId`  | string | Yes      | Task UUID   |

**Returns:** Prompt-ready text with full context including issue, plan, and task details. Includes generated session ID.

---

### log_task_progress

Log progress during task execution.

| Parameter       | Type     | Required | Description                                                      |
| --------------- | -------- | -------- | ---------------------------------------------------------------- |
| `taskId`        | string   | Yes      | Task UUID                                                        |
| `sessionId`     | string   | Yes      | Session ID executing the task                                    |
| `message`       | string   | Yes      | What was done (e.g., 'Created user model in src/models/user.ts') |
| `filesModified` | string[] | No       | List of files touched                                            |

**Use Case:** Creates audit trail. Log at milestones (2-5 entries per task typically).

---

### get_task_execution_log

Get the execution log for a task.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `taskId`  | string | Yes      | Task UUID   |

**Returns:** Array of log entries with sessionId, message, filesModified, and timestamp.

---

### check_task_conflicts

Check for potential file conflicts before starting a task.

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| `taskId`  | string | Yes      | Task UUID to check |

**Returns:** Warnings about files modified by prior completed tasks in the same plan. This is a dry-run that doesn't start the task.

---

## PR Workflow

### create_pr

Create a PR for a task.

| Parameter    | Type    | Required | Description                                                            |
| ------------ | ------- | -------- | ---------------------------------------------------------------------- |
| `taskId`     | string  | Yes      | Task UUID                                                              |
| `title`      | string  | No       | PR title (defaults to `[#N] taskTitle` where N is GitHub issue number) |
| `body`       | string  | No       | PR body (GitHub issue linking added automatically)                     |
| `draft`      | boolean | No       | Create as draft PR (default: false)                                    |
| `baseBranch` | string  | No       | Target branch (default: main)                                          |
| `force`      | boolean | No       | Bypass status validation                                               |

**Behavior:**

- Pushes branch to remote
- Creates PR with GitHub issue linking
- Does NOT change task status (stays IN_PROGRESS)
- Use `submit_for_review` afterward to transition to PR_REVIEW

---

### submit_for_review

Submit a task for review.

| Parameter | Type    | Required | Description                 |
| --------- | ------- | -------- | --------------------------- |
| `taskId`  | string  | Yes      | Task UUID                   |
| `force`   | boolean | No       | Bypass status/PR validation |

**Behavior:**

- Transitions task status from IN_PROGRESS to PR_REVIEW
- Syncs to GitHub's "In Review" column
- Task must have a PR created via `create_pr` first

---

### get_task_pr_status

Get the PR status for a task.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `taskId`  | string | Yes      | Task UUID   |

**Returns:**

```json
{
  "hasPR": true,
  "pr": {
    "number": 42,
    "url": "https://github.com/...",
    "title": "...",
    "state": "OPEN",
    "status": "OPEN",
    "isDraft": false,
    "merged": false,
    "mergeable": true,
    "headBranch": "...",
    "baseBranch": "main"
  }
}
```

---

### complete_task

Complete a task after PR is merged.

| Parameter        | Type    | Required | Description                                  |
| ---------------- | ------- | -------- | -------------------------------------------- |
| `taskId`         | string  | Yes      | Task UUID                                    |
| `sessionId`      | string  | Yes      | Claude session ID                            |
| `finalLogEntry`  | string  | Yes      | Summary of what was accomplished (required)  |
| `force`          | boolean | No       | Bypass state validation                      |
| `autoCloseIssue` | boolean | No       | Close parent issue if all tasks are complete |

**Behavior:**

- Verifies PR is merged
- Pulls main
- Cleans up worktree and branch
- Transitions to COMPLETED

**Returns:** Includes `allTasksComplete` boolean and `nextTask` suggestion.

---

## Milestones

### create_milestone

Create a new milestone for grouping issues.

| Parameter     | Type   | Required | Description                     |
| ------------- | ------ | -------- | ------------------------------- |
| `title`       | string | Yes      | Milestone title                 |
| `description` | string | No       | Milestone description           |
| `startDate`   | string | Yes      | Start date in YYYY-MM-DD format |
| `endDate`     | string | Yes      | End date in YYYY-MM-DD format   |

**Status Computation:** Status is computed automatically from issue states (PLANNED until work starts, then IN_PROGRESS, DELAYED if past endDate).

---

### get_milestone

Get milestone by ID or number.

| Parameter         | Type   | Required | Description                       |
| ----------------- | ------ | -------- | --------------------------------- |
| `id`              | string | No       | Milestone UUID                    |
| `milestoneNumber` | number | No       | Milestone number (e.g., 1 for M1) |

**Returns:** Milestone with computed status, assigned issues, and summary counts.

---

### list_milestones

List milestones with optional filters.

| Parameter | Type | Required | Description                                                                 |
| --------- | ---- | -------- | --------------------------------------------------------------------------- |
| `status`  | enum | No       | Filter by computed status: `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `DELAYED` |

**Returns:** Array of milestones with computed status and issue counts.

---

### update_milestone

Update a milestone's properties.

| Parameter         | Type   | Required | Description                                                       |
| ----------------- | ------ | -------- | ----------------------------------------------------------------- |
| `milestoneNumber` | number | Yes      | Milestone number                                                  |
| `updates`         | object | Yes      | Fields to update (title, description, startDate, endDate, status) |

**Note:** Status can only be set to COMPLETED (manual sign-off). PLANNED, IN_PROGRESS, and DELAYED are computed automatically.

---

### delete_milestone

Delete a milestone.

| Parameter         | Type   | Required | Description      |
| ----------------- | ------ | -------- | ---------------- |
| `milestoneNumber` | number | Yes      | Milestone number |

**Side Effect:** Issues assigned to it will become unassigned.

---

### assign_issue_to_milestone

Assign an issue to a milestone.

| Parameter         | Type   | Required | Description                   |
| ----------------- | ------ | -------- | ----------------------------- |
| `issueNumber`     | number | Yes      | Issue number to assign        |
| `milestoneNumber` | number | Yes      | Milestone number to assign to |

---

### remove_issue_from_milestone

Remove an issue from its milestone.

| Parameter     | Type   | Required | Description            |
| ------------- | ------ | -------- | ---------------------- |
| `issueNumber` | number | Yes      | Issue number to remove |

---

## Snapshots

### get_snapshot_history

Get version history for an issue showing all snapshots.

| Parameter     | Type   | Required | Description                |
| ------------- | ------ | -------- | -------------------------- |
| `issueId`     | string | No       | Issue UUID                 |
| `issueNumber` | number | No       | Issue number (alternative) |

**Returns:** Array of snapshots with version numbers, timestamps, and change summaries.

---

### revert_to_snapshot

Revert issue to a previous version.

| Parameter     | Type   | Required | Description                 |
| ------------- | ------ | -------- | --------------------------- |
| `issueNumber` | number | Yes      | Issue number                |
| `version`     | number | Yes      | Version number to revert to |
| `notes`       | string | No       | Reason for reversion        |

**Behavior:** Creates a new snapshot based on old data (non-destructive).

---

### view_snapshot

View the complete state of an issue at a specific version.

| Parameter     | Type   | Required | Description            |
| ------------- | ------ | -------- | ---------------------- |
| `issueNumber` | number | Yes      | Issue number           |
| `version`     | number | Yes      | Version number to view |

**Returns:** Read-only time-travel view of the issue at that version.

---

## Settings

### update_settings

Configure project settings including GitHub integration.

| Parameter            | Type    | Required | Description                      |
| -------------------- | ------- | -------- | -------------------------------- |
| `action`             | enum    | Yes      | See actions below                |
| `github`             | object  | No       | GitHub configuration options     |
| `resetColumnMapping` | boolean | No       | Reset column mapping to defaults |

**Actions:**

| Action                     | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `get_settings`             | Returns current configuration and gh CLI status                     |
| `enable_github`            | Enables GitHub issue sync with validation                           |
| `disable_github`           | Disables issue sync                                                 |
| `configure_github`         | Updates labels, projectId, assignee config                          |
| `configure_column_mapping` | Updates status-to-column mapping for project boards                 |
| `list_available_labels`    | Returns available label fields from the project management provider |

**GitHub Configuration Options:**

| Field                 | Type     | Description                                                         |
| --------------------- | -------- | ------------------------------------------------------------------- |
| `projectId`           | string   | GitHub Project ID (format: PVT\_...)                                |
| `assignee`            | string   | GitHub username for auto-assignment (no @ prefix)                   |
| `labels.typeMappings` | object   | Maps issue types to GitHub labels (required type-to-label mappings) |
| `labels.customLabels` | string[] | Additional labels for all synced issues                             |
| `columnMapping`       | object   | Maps task statuses to project board columns                         |

**Default Column Mapping:**

```json
{
  "BACKLOG": "Backlog",
  "READY": "Ready",
  "IN_PROGRESS": "In Progress",
  "PR_REVIEW": "In Review",
  "COMPLETED": "Done",
  "ABANDONED": "Done"
}
```

---

## Worktrees

### list_worktrees

List all active git worktrees.

| Parameter | Type | Required | Description            |
| --------- | ---- | -------- | ---------------------- |
| (none)    | -    | -        | No parameters required |

**Returns:** Main worktree, task worktrees, summary with total disk usage.

---

### prune_stale_worktrees

Remove stale worktrees that are no longer linked to the filesystem.

| Parameter | Type | Required | Description            |
| --------- | ---- | -------- | ---------------------- |
| (none)    | -    | -        | No parameters required |

**Returns:** Number of pruned worktrees and remaining count.

---

## Merge

### merge_issues

Merge two issues into one.

| Parameter           | Type   | Required | Description                               |
| ------------------- | ------ | -------- | ----------------------------------------- |
| `sourceIssueNumber` | number | Yes      | Issue being merged from                   |
| `targetIssueNumber` | number | Yes      | Target issue (for merge_into mode)        |
| `mode`              | enum   | Yes      | `create_new` or `merge_into`              |
| `newTitle`          | string | No       | Custom title (create_new mode only)       |
| `newDescription`    | string | No       | Custom description (create_new mode only) |

**Modes:**

- `create_new`: Creates a fresh issue combining both sources (originals unchanged)
- `merge_into`: Folds source into target (source is soft-deleted)

**Returns:** Result issue, merged task count, warnings for in-progress or PR-review tasks.

---

## Types

### list_types

List all available issue/task types.

| Parameter | Type | Required | Description            |
| --------- | ---- | -------- | ---------------------- |
| (none)    | -    | -        | No parameters required |

**Returns:** Array of types with name, description, and remoteLabel.

**Use Case:** Call this before `generate_plan` to know valid type values.

**Example Response:**

```json
{
  "types": [
    { "name": "FEATURE", "description": "New functionality", "remoteLabel": "feature" },
    { "name": "BUG", "description": "Bug fix", "remoteLabel": "bug" },
    {
      "name": "ENHANCEMENT",
      "description": "Improvement to existing feature",
      "remoteLabel": "enhancement"
    },
    { "name": "TASK", "description": "General task", "remoteLabel": "task" },
    { "name": "SPIKE", "description": "Research/investigation", "remoteLabel": "spike" }
  ]
}
```

---

## Dispatch

### dispatch_task

Add a task to the dispatch queue for worker execution.

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `taskId`  | string | Yes      | Task UUID to dispatch |

**Behavior:**

- Idempotent - returns existing entry if task is already queued
- Only BACKLOG or READY tasks can be dispatched
- Workers poll and claim tasks from this queue

**Use Case:** Use instead of `load_task_session` when you want a background worker to pick up the task.

---

### end_worker_session

Signal that the Claude worker session is complete.

| Parameter  | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `workerId` | string | Yes      | Worker UUID (provided in the worker prompt) |
| `taskId`   | string | Yes      | Task UUID that was being worked on          |

**Behavior:**

- This is the TERMINAL action for worker tasks
- Sets the `claudeDone` flag which workers poll for before terminating
- Think of this like `process.exit()` - there is no "after"
- Must be called after `complete_task` or `abandon_task`

---

## Common Workflows

### Creating and Planning an Issue

```
1. create_issue → Creates issue in PLANNED status
2. generate_plan → Creates plan with tasks
3. move_issue_to_backlog → Activates issue (PLANNED→OPEN) and tasks (PLANNED→BACKLOG)
```

### Executing a Task

```
1. list_available_tasks → Find tasks to work on
2. load_task_session → Start working (BACKLOG/READY→IN_PROGRESS)
3. [Do the work, log_task_progress]
4. create_pr → Push branch, create PR
5. submit_for_review → Transition to PR_REVIEW
6. [Wait for PR to be merged]
7. complete_task → Clean up, transition to COMPLETED
```

### Worker Flow

```
1. dispatch_task → Add to worker queue
2. [Worker claims task]
3. load_task_session (with workerId) → Start in isolated mode
4. [Complete all work, create PR, wait for merge]
5. complete_task → Finish task
6. end_worker_session → Signal worker completion (terminal)
```

---

## Error Handling

### Force Mode

Several tools support `force=true` to bypass state machine validation when task/issue state has drifted:

| Tool                | What force bypasses                                |
| ------------------- | -------------------------------------------------- |
| `create_pr`         | IN_PROGRESS status check                           |
| `submit_for_review` | IN_PROGRESS status and PR existence check          |
| `complete_task`     | Status check (allows completing from wrong status) |
| `abandon_task`      | Session ownership check                            |
| `close_issue`       | Task completion check                              |

**Protocol:** Always get explicit user confirmation before using `force=true`.

### Common Errors

| Error                         | Resolution                                                |
| ----------------------------- | --------------------------------------------------------- |
| "Task not found"              | Verify task ID or use `get_task(issueNumber, taskNumber)` |
| "Issue not found"             | Check issue number/ID                                     |
| "PR not merged"               | Wait for PR merge, then retry `complete_task`             |
| "Tasks not in terminal state" | Complete/abandon remaining tasks, or use `force=true`     |
| "GitHub sync failed"          | Check `gh auth status`, run `sync_issue` to repair        |
| "Invalid type"                | Call `list_types` first to get valid values               |

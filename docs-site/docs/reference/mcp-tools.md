---
sidebar_position: 2
---

# MCP Tools Reference

Complete reference for all 55 MCP tools provided by dev-workflow.

## Overview

| Category | Tools | Description |
|----------|-------|-------------|
| Issue Management | 16 | Create, read, update, delete issues |
| Plan Management | 5 | Generate and manage plans |
| Task Management | 10 | Work on and track tasks |
| Snapshot Management | 3 | Version history |
| Milestone Management | 7 | Time-bounded planning |
| Worktree Management | 2 | Git worktree management |
| PR Tools | 4 | Pull request lifecycle |
| Merge Tools | 1 | Combine issues |
| Type Management | 4 | Custom type management |
| Dispatch Tools | 3 | Worker coordination |

---

## Issue Management

### create_issue

Create a new issue in the task tracker.

```typescript
create_issue({
  title: string,              // Required
  description: string,        // Required
  type?: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK",
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  acceptanceCriteria?: string[],
  labels?: Record<string, string>,
  useTemplate?: boolean,      // Auto-select template (default: true)
  createdBy?: string          // Default: "mcp"
})
```

### get_issue

Get issue by number with optional plan.

```typescript
get_issue({
  issueNumber: number,        // Required
  includePlan?: boolean       // Include tasks (default: false)
})
```

### update_issue

Update issue properties.

```typescript
update_issue({
  issueNumber: number,        // Required
  updates: {
    title?: string,
    description?: string,
    type?: string,
    priority?: string,
    acceptanceCriteria?: string[],
    labels?: Record<string, string>
  }
})
```

### delete_issue

Soft delete an issue. Only PLANNED issues can be deleted.

```typescript
delete_issue({
  issueNumber: number,        // Required
  deletedBy?: string
})
```

### restore_issue

Restore a soft-deleted issue.

```typescript
restore_issue({
  issueNumber: number         // Required
})
```

### close_issue

Close an issue. All tasks must be in terminal state.

```typescript
close_issue({
  issueNumber: number,        // Required
  force?: boolean             // Bypass task state check
})
```

### change_issue_type

Change an issue's type.

```typescript
change_issue_type({
  issueNumber: number,        // Required
  type: string                // Required
})
```

### search_issues

Search issues by keyword.

```typescript
search_issues({
  query: string               // Required (case-insensitive)
})
```

### get_project_stats

Get project statistics.

```typescript
get_project_stats({})
```

Returns issue and task counts by status.

### get_work_queue

Get prioritized work queue.

```typescript
get_work_queue({})
```

Returns top issues and tasks, plus issues needing planning.

### list_templates

List available issue templates.

```typescript
list_templates({
  category?: "issue" | "task",
  scope?: "local" | "global" | "all",
  type?: string               // Filter by type
})
```

### get_template

Get a template's full content.

```typescript
get_template({
  filename: string,           // Required (e.g., "feature.md")
  category?: "issue" | "task",
  scope?: "local" | "global"
})
```

### create_template

Create a new template.

```typescript
create_template({
  filename: string,           // Required
  content: string,            // Required (markdown with frontmatter)
  category?: "issue" | "task",
  scope?: "local" | "global"
})
```

### update_template

Update an existing template.

```typescript
update_template({
  filename: string,           // Required
  content: string,            // Required
  category?: "issue" | "task",
  scope?: "local" | "global"
})
```

### delete_template

Delete a template.

```typescript
delete_template({
  filename: string,           // Required
  category?: "issue" | "task",
  scope?: "local" | "global"
})
```

### copy_template

Copy template between scopes.

```typescript
copy_template({
  filename: string,           // Required
  category: "issue" | "task", // Required
  fromScope: "local" | "global", // Required
  toScope: "local" | "global"    // Required
})
```

---

## Plan Management

### generate_plan

Generate or regenerate an implementation plan.

```typescript
generate_plan({
  issueNumber: number,        // Required
  summary: string,            // Required
  approach: string,           // Required
  estimatedComplexity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH",
  tasks: Array<{
    id: string,               // Placeholder ID for dependencies
    title: string,
    description: string,
    type: string,             // Must be valid type
    dependsOn?: string[],     // References to other task ids
    acceptanceCriteria?: string[],
    estimatedMinutes?: number,
    implementationPlan?: string
  }>
})
```

### get_plan

Get the active plan for an issue.

```typescript
get_plan({
  issueNumber: number         // Required
})
```

### move_issue_to_backlog

Activate a plan. Transitions PLANNED → OPEN.

```typescript
move_issue_to_backlog({
  issueNumber: number,        // Required
  skipGitHubSync?: boolean    // Skip creating GitHub issues
})
```

### move_issue_to_ready

Mark tasks as ready for work.

```typescript
move_issue_to_ready({
  issueNumber: number         // Required
})
```

### pause_issue

Pause work on an issue.

```typescript
pause_issue({
  issueNumber: number         // Required
})
```

---

## Task Management

### load_task_session

Load a task for execution.

```typescript
load_task_session({
  taskId: string,             // Required
  sessionId: string,          // Required
  mode?: "isolated" | "branch" | "main",  // Default: isolated
  workerId?: string           // Required for workers
})
```

### abandon_task

Abandon a task in progress.

```typescript
abandon_task({
  taskId: string,             // Required
  sessionId: string,          // Required
  reason?: string,
  force?: boolean
})
```

### get_task

Get task details.

```typescript
get_task({
  taskId?: string,            // UUID
  issueNumber?: number,       // Alternative lookup
  taskNumber?: number         // With issueNumber
})
```

### list_available_tasks

List tasks available for work.

```typescript
list_available_tasks({
  issueNumber?: number,       // Filter by issue
  planId?: string             // Filter by plan
})
```

### delete_task

Delete a PLANNED task.

```typescript
delete_task({
  taskId: string              // Required
})
```

### update_task

Update task properties.

```typescript
update_task({
  taskId: string,             // Required
  title?: string,
  description?: string,
  acceptanceCriteria?: string[],
  estimatedMinutes?: number,
  implementationPlan?: string,
  labels?: Record<string, string | null>
})
```

### get_task_execution_prompt

Generate execution prompt for a task.

```typescript
get_task_execution_prompt({
  taskId: string              // Required
})
```

### log_task_progress

Log progress during execution.

```typescript
log_task_progress({
  taskId: string,             // Required
  sessionId: string,          // Required
  message: string,            // Required
  filesModified?: string[]
})
```

### get_task_execution_log

Get execution log for a task.

```typescript
get_task_execution_log({
  taskId: string              // Required
})
```

### check_task_conflicts

Check for file conflicts.

```typescript
check_task_conflicts({
  taskId: string              // Required
})
```

---

## Snapshot Management

### get_snapshot_history

Get version history for an issue.

```typescript
get_snapshot_history({
  issueNumber: number         // Required
})
```

### view_snapshot

View issue at specific version.

```typescript
view_snapshot({
  issueNumber: number,        // Required
  version: number             // Required
})
```

### revert_to_snapshot

Revert to previous version.

```typescript
revert_to_snapshot({
  issueNumber: number,        // Required
  version: number,            // Required
  notes?: string
})
```

---

## Milestone Management

### create_milestone

Create a new milestone.

```typescript
create_milestone({
  title: string,              // Required
  description?: string,
  startDate: string,          // Required (YYYY-MM-DD)
  endDate: string             // Required (YYYY-MM-DD)
})
```

### get_milestone

Get milestone details.

```typescript
get_milestone({
  milestoneNumber: number     // Required
})
```

### list_milestones

List all milestones.

```typescript
list_milestones({
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED"
})
```

### update_milestone

Update milestone properties.

```typescript
update_milestone({
  milestoneNumber: number,    // Required
  updates: {
    title?: string,
    description?: string,
    startDate?: string,
    endDate?: string,
    status?: "COMPLETED"      // Only COMPLETED can be set
  }
})
```

### delete_milestone

Delete a milestone.

```typescript
delete_milestone({
  milestoneNumber: number     // Required
})
```

### assign_issue_to_milestone

Assign issue to milestone.

```typescript
assign_issue_to_milestone({
  issueNumber: number,        // Required
  milestoneNumber: number     // Required
})
```

### remove_issue_from_milestone

Remove issue from milestone.

```typescript
remove_issue_from_milestone({
  issueNumber: number         // Required
})
```

---

## Worktree Management

### list_worktrees

List active git worktrees.

```typescript
list_worktrees({})
```

### prune_stale_worktrees

Clean up orphaned worktrees.

```typescript
prune_stale_worktrees({})
```

---

## PR Tools

### get_task_pr_status

Get PR status for a task.

```typescript
get_task_pr_status({
  taskId: string              // Required
})
```

### create_pr

Create a PR for a task.

```typescript
create_pr({
  taskId: string,             // Required
  title?: string,
  body?: string,
  baseBranch?: string,        // Default: main
  draft?: boolean,
  force?: boolean
})
```

### submit_for_review

Submit task for code review.

```typescript
submit_for_review({
  taskId: string,             // Required
  force?: boolean
})
```

### complete_task

Complete a task after PR merge.

```typescript
complete_task({
  taskId: string,             // Required
  sessionId: string,          // Required
  finalLogEntry: string,      // Required
  force?: boolean,
  autoCloseIssue?: boolean
})
```

---

## Merge Tools

### merge_issues

Merge two issues into one.

```typescript
merge_issues({
  sourceIssueNumber: number,  // Required
  targetIssueNumber: number,  // Required
  mode: "create_new" | "merge_into",  // Required
  newTitle?: string,          // For create_new mode
  newDescription?: string
})
```

---

## Type Management

### list_types

List available issue/task types.

```typescript
list_types({})
```

### create_type

Create a custom type.

```typescript
create_type({
  name: string,               // Required (uppercase)
  displayName: string,        // Required
  description: string,        // Required
  keywords?: string[],
  color?: string              // Hex color
})
```

### update_type

Update type properties.

```typescript
update_type({
  name: string,               // Required
  updates: {
    displayName?: string,
    description?: string,
    keywords?: string[],
    color?: string | null
  }
})
```

### delete_type

Soft-delete a type.

```typescript
delete_type({
  name: string                // Required
})
```

---

## Dispatch Tools

### dispatch_task

Add task to dispatch queue.

```typescript
dispatch_task({
  taskId: string              // Required
})
```

### get_dispatch_status

Get worker and queue status.

```typescript
get_dispatch_status({})
```

### end_worker_session

Signal worker session complete.

```typescript
end_worker_session({
  workerId: string,           // Required
  taskId: string              // Required
})
```

---

## Error Handling

### Common Error Patterns

| Error | Meaning | Solution |
|-------|---------|----------|
| "Issue not found" | Invalid issue number | Check issue exists |
| "Task in progress" | Session conflict | Wait or use force |
| "Invalid type" | Unknown type name | Check `list_types` |
| "Cannot delete" | Wrong status | Use appropriate action |

### Force Mode

Several tools support `force: true` to bypass validation. Always get user confirmation before using force mode.

## Next Steps

- [Configuration Guide](/reference/configuration)
- [Claude Skills Reference](/reference/claude-skills)

/**
 * MCP Tool Definitions generated from Zod schemas
 *
 * This module exports all tool definitions with JSON Schema inputSchema
 * generated from the Zod schemas colocated in each tool file.
 */

import { createToolDefinition } from "./schema-utils.js";

// Import schemas from handler files
import {
  CreateIssueSchema,
  GetIssueSchema,
  DeleteIssueSchema,
  RestoreIssueSchema,
  ListTemplatesSchema,
  GetTemplateSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  DeleteTemplateSchema,
  CopyTemplateSchema,
  UpdateIssueSchema,
  CloseIssueSchema,
  ChangeIssueTypeSchema,
  GetProjectStatsSchema,
  SearchIssuesSchema,
  GetWorkQueueSchema,
  ImportGitHubIssueSchema,
} from "./issue-tools.js";

import {
  GeneratePlanSchema,
  GetPlanSchema,
  PauseIssueSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  SyncIssueSchema,
} from "./plan-tools.js";

import {
  LoadTaskSessionSchema,
  AbandonTaskSchema,
  GetTaskSchema,
  ListAvailableTasksSchema,
  DeleteTaskSchema,
  UpdateTaskSchema,
  GetTaskExecutionPromptSchema,
  LogTaskProgressSchema,
  GetTaskExecutionLogSchema,
  CheckTaskConflictsSchema,
} from "./task-tools.js";

import {
  GetSnapshotHistorySchema,
  RevertToSnapshotSchema,
  ViewSnapshotSchema,
} from "./snapshot-tools.js";

import { UpdateSettingsSchema } from "./settings-tools.js";

import {
  CreateMilestoneSchema,
  GetMilestoneSchema,
  ListMilestonesSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneSchema,
} from "./milestone-tools.js";

import { ListWorktreesSchema, PruneStaleWorktreesSchema } from "./worktree-tools.js";

import {
  GetTaskPRStatusSchema,
  CreatePRSchema,
  SubmitForReviewSchema,
  CompleteTaskSchema,
} from "./pr-tools.js";

import { MergeIssuesSchema } from "./merge-tools.js";

import {
  ListTypesSchema,
  CreateTypeSchema,
  UpdateTypeSchema,
  DeleteTypeSchema,
} from "./type-tools.js";

import {
  DispatchTaskSchema,
  GetDispatchStatusSchema,
  EndWorkerSessionSchema,
} from "./dispatch-tools.js";

// =============================================================================
// Issue Tool Definitions
// =============================================================================

export const issueToolDefinitions = [
  createToolDefinition(
    "create_issue",
    "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Creates a new issue in the task tracker.",
    CreateIssueSchema
  ),
  createToolDefinition(
    "get_issue",
    "Get issue by ID or number. Optionally include the plan with tasks.",
    GetIssueSchema
  ),
  createToolDefinition(
    "delete_issue",
    "Soft delete an issue. Only PLANNED issues can be deleted. " +
      "Once work begins (status changes to OPEN or IN_PROGRESS), the issue structure becomes immutable. " +
      "Use close_issue instead for issues past PLANNED status.",
    DeleteIssueSchema
  ),
  createToolDefinition(
    "restore_issue",
    "Restore a soft-deleted issue. The issue will be included in search and work queue again. Associated plans and tasks become accessible again.",
    RestoreIssueSchema
  ),
  createToolDefinition(
    "list_templates",
    "List available issue templates. Returns both user-defined and default templates with their metadata.",
    ListTemplatesSchema
  ),
  createToolDefinition(
    "get_template",
    "Get a single issue template by filename with its full content and source information.",
    GetTemplateSchema
  ),
  createToolDefinition(
    "create_template",
    "Create a new template. Templates use markdown with YAML frontmatter for metadata. Cannot create a template if one with the same name already exists at the target scope.",
    CreateTemplateSchema
  ),
  createToolDefinition(
    "update_template",
    "Update an existing template at the specified scope.",
    UpdateTemplateSchema
  ),
  createToolDefinition(
    "delete_template",
    "Delete a template at the specified scope.",
    DeleteTemplateSchema
  ),
  createToolDefinition(
    "copy_template",
    "Copy a template between local and global scopes. Useful for customizing global templates locally or promoting local templates to global.",
    CopyTemplateSchema
  ),
  createToolDefinition(
    "update_issue",
    "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Updates an issue. Optionally regenerate plan after update (you'll need to call generate_plan separately if needed).",
    UpdateIssueSchema
  ),
  createToolDefinition(
    "close_issue",
    "Close an issue. Validates all tasks are in terminal state (COMPLETED or ABANDONED). " +
      "Syncs to GitHub if the issue has a linked GitHub issue. " +
      "Use force=true to bypass task state validation when issue state has drifted.",
    CloseIssueSchema
  ),
  createToolDefinition(
    "change_issue_type",
    "Change an issue's type. Validates the type against available types " +
      "(from ./.track/types.md if present, otherwise defaults). " +
      "Use this when auto-assigned type is incorrect.",
    ChangeIssueTypeSchema
  ),
  createToolDefinition(
    "get_project_stats",
    "Get project statistics: issue and task counts by status. Use this for a quick overview without loading all issues.",
    GetProjectStatsSchema
  ),
  createToolDefinition(
    "search_issues",
    "Search issues by keyword in title or description. Returns slim results (number, title, status, type, priority). Max 10 results.",
    SearchIssuesSchema
  ),
  createToolDefinition(
    "get_work_queue",
    "Get prioritized work queue: top 3 issues and top 3 tasks to work on next. Also includes issues that need planning (PLANNED status without a plan). Considers status, priority, milestone deadlines, and task readiness.",
    GetWorkQueueSchema
  ),
  createToolDefinition(
    "import_github_issue",
    "Import an existing GitHub issue into dev-workflow. Creates a dev-workflow issue from the GitHub issue's title and description. " +
      "Does NOT create tasks - use generate_plan after import. Does NOT modify the original GitHub issue. " +
      "The imported issue stores sourceGitHubIssueNumber to track the link.",
    ImportGitHubIssueSchema
  ),
];

// =============================================================================
// Plan Tool Definitions
// =============================================================================

export const planToolDefinitions = [
  createToolDefinition(
    "generate_plan",
    "⚠️ Prefer 'dwf-plan-issue' skill for proper workflow. Generates or regenerates an implementation plan for an issue with tasks. Automatically preserves in-progress and completed tasks from previous plan when possible.",
    GeneratePlanSchema
  ),
  createToolDefinition("get_plan", "Get the active plan for an issue with tasks", GetPlanSchema),
  createToolDefinition(
    "pause_issue",
    "Pause work on an issue by moving all READY tasks back to BACKLOG. This allows temporarily deactivating a plan. When work resumes (any task is started), the BACKLOG tasks will transition back to READY.",
    PauseIssueSchema
  ),
  createToolDefinition(
    "move_issue_to_ready",
    "Mark an issue as 'next up' by moving all BACKLOG tasks to READY. This allows signaling an issue is ready for work without starting any specific task. Idempotent: does nothing if tasks are not in BACKLOG state.",
    MoveIssueToReadySchema
  ),
  createToolDefinition(
    "move_issue_to_backlog",
    "Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG. Creates GitHub issues for each task (if GitHub sync is enabled). This confirms the plan is finalized and makes tasks available for work. User must confirm the plan before calling this tool.",
    MoveIssueToBacklogSchema
  ),
  createToolDefinition(
    "sync_issue",
    "Repair GitHub sync state for an issue. Creates missing GitHub issues for tasks, links existing GitHub issues found by title search, and verifies already-synced tasks. Idempotent: safe to run multiple times. Use this to recover from partial syncs or errors during move_issue_to_backlog. Respects imported vs non-imported issue logic.",
    SyncIssueSchema
  ),
];

// =============================================================================
// Task Tool Definitions
// =============================================================================

export const taskToolDefinitions = [
  createToolDefinition(
    "load_task_session",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Load a task for execution. " +
      "Returns full context (task, issue, plan) and starts/resumes the session. " +
      "Idempotent: if task is already IN_PROGRESS, returns context without restarting. " +
      "ALWAYS use 'isolated' mode (default) unless user explicitly requests otherwise.",
    LoadTaskSessionSchema
  ),
  createToolDefinition(
    "abandon_task",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Abandons the current task. Marks task as ABANDONED. " +
      "Use force=true to bypass session ownership validation when state has drifted.",
    AbandonTaskSchema
  ),
  createToolDefinition(
    "get_task",
    "Get task details by ID or number for quick lookups and questions about tasks. Returns task data only without loading execution context. Use load_task_session to start/resume work on a task with full context.",
    GetTaskSchema
  ),
  createToolDefinition(
    "list_available_tasks",
    "List tasks available to work on (BACKLOG or READY status, not locked by another session).",
    ListAvailableTasksSchema
  ),
  createToolDefinition(
    "delete_task",
    "Delete a task (soft delete). Only PLANNED tasks can be deleted. Once an issue moves to BACKLOG (via move_issue_to_backlog), task numbers become immutable. Use abandon_task instead for tasks past PLANNED status.",
    DeleteTaskSchema
  ),
  createToolDefinition(
    "update_task",
    'Update a task\'s properties. Use for tuning task details before execution. Labels support both simple tags (empty string value) and key-value pairs. Example: { "urgent": "", "product": "Case Workflow" }',
    UpdateTaskSchema
  ),
  createToolDefinition(
    "get_task_execution_prompt",
    "Generate a prompt for executing a task. Returns prompt-ready text with full context including issue, plan, and task details.",
    GetTaskExecutionPromptSchema
  ),
  createToolDefinition(
    "log_task_progress",
    "Log progress during task execution (for audit trail). Call this to record what you're doing.",
    LogTaskProgressSchema
  ),
  createToolDefinition(
    "get_task_execution_log",
    "Get the execution log for a task. Shows recorded progress entries from task execution.",
    GetTaskExecutionLogSchema
  ),
  createToolDefinition(
    "check_task_conflicts",
    "Check for potential file conflicts before starting a task. Returns warnings about files modified by prior completed tasks in the same plan. This is a dry-run that doesn't start the task.",
    CheckTaskConflictsSchema
  ),
];

// =============================================================================
// Snapshot Tool Definitions
// =============================================================================

export const snapshotToolDefinitions = [
  createToolDefinition(
    "get_snapshot_history",
    "Get version history for an issue showing all snapshots",
    GetSnapshotHistorySchema
  ),
  createToolDefinition(
    "revert_to_snapshot",
    "Revert issue to a previous version snapshot. Creates new snapshot based on old data.",
    RevertToSnapshotSchema
  ),
  createToolDefinition(
    "view_snapshot",
    "View the complete state of an issue at a specific version (time travel, read-only).",
    ViewSnapshotSchema
  ),
];

// =============================================================================
// Settings Tool Definitions
// =============================================================================

export const settingsToolDefinitions = [
  createToolDefinition(
    "update_settings",
    "Configure project settings including GitHub issue sync. Repository owner/repo are auto-detected from git remotes. Validates gh CLI auth and repository access before enabling.",
    UpdateSettingsSchema
  ),
];

// =============================================================================
// Milestone Tool Definitions
// =============================================================================

export const milestoneToolDefinitions = [
  createToolDefinition(
    "create_milestone",
    "Create a new milestone for grouping issues with a time range. Status is computed automatically from issue states (PLANNED until work starts, then IN_PROGRESS, DELAYED if past endDate).",
    CreateMilestoneSchema
  ),
  createToolDefinition("get_milestone", "Get milestone by ID or number", GetMilestoneSchema),
  createToolDefinition(
    "list_milestones",
    "List milestones with optional filters. Status is computed automatically from issue states.",
    ListMilestonesSchema
  ),
  createToolDefinition(
    "update_milestone",
    "Update a milestone's properties. Status is automatically computed (PLANNED, IN_PROGRESS, DELAYED) except COMPLETED which requires manual sign-off.",
    UpdateMilestoneSchema
  ),
  createToolDefinition(
    "delete_milestone",
    "Delete a milestone. Issues assigned to it will become unassigned.",
    DeleteMilestoneSchema
  ),
  createToolDefinition(
    "assign_issue_to_milestone",
    "Assign an issue to a milestone",
    AssignIssueToMilestoneSchema
  ),
  createToolDefinition(
    "remove_issue_from_milestone",
    "Remove an issue from its milestone (unassign)",
    RemoveIssueFromMilestoneSchema
  ),
];

// =============================================================================
// Worktree Tool Definitions
// =============================================================================

export const worktreeToolDefinitions = [
  createToolDefinition(
    "list_worktrees",
    "List all active git worktrees with their status and disk usage. Worktrees provide isolated environments for parallel task execution.",
    ListWorktreesSchema
  ),
  createToolDefinition(
    "prune_stale_worktrees",
    "Remove stale worktrees that are no longer linked to the filesystem. This cleans up orphaned worktree references.",
    PruneStaleWorktreesSchema
  ),
];

// =============================================================================
// PR Tool Definitions
// =============================================================================

export const prToolDefinitions = [
  createToolDefinition(
    "get_task_pr_status",
    "Get the PR status for a task. Returns PR details if one exists.",
    GetTaskPRStatusSchema
  ),
  createToolDefinition(
    "create_pr",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Create a PR for a task. Pushes branch and creates PR with GitHub issue linking. Does NOT change task status (stays IN_PROGRESS). Use submit_for_review afterward to transition to PR_REVIEW. Task must be IN_PROGRESS with a worktree/branch. Use force=true to bypass status validation when task state has drifted. Claude MUST ask user permission before using force=true.",
    CreatePRSchema
  ),
  createToolDefinition(
    "submit_for_review",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Submit a task for review. Transitions task status from IN_PROGRESS to PR_REVIEW and syncs to GitHub. Task must have a PR created via create_pr first. Use force=true to bypass validation when task state has drifted. Claude MUST ask user permission before using force=true.",
    SubmitForReviewSchema
  ),
  createToolDefinition(
    "complete_task",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Complete a task after PR is merged. Atomically: verifies PR is merged, pulls main, cleans up worktree/branch, transitions status to COMPLETED. Task must be in PR_REVIEW status with a merged PR. Use force=true to bypass state validation when task state has drifted (e.g., PR already merged but task status is wrong).",
    CompleteTaskSchema
  ),
];

// =============================================================================
// Merge Tool Definitions
// =============================================================================

export const mergeToolDefinitions = [
  createToolDefinition(
    "merge_issues",
    "Merge two issues into one. Supports two modes: 'create_new' creates a fresh issue combining both sources (originals unchanged), 'merge_into' folds source into target (source is soft-deleted). Tasks from both issues are copied/moved to the result. Returns warnings for any in-progress or PR-review tasks.",
    MergeIssuesSchema
  ),
];

// =============================================================================
// Type Tool Definitions
// =============================================================================

export const typeToolDefinitions = [
  createToolDefinition(
    "list_types",
    "List all available issue/task types with their remote label mappings. Returns array of types with name, description, and remoteLabel. Use this before generate_plan to know valid type values.",
    ListTypesSchema
  ),
  createToolDefinition(
    "create_type",
    "Create a new issue/task type. Types must have unique uppercase names. Keywords help Claude select the right type based on issue descriptions. Example: create_type('EPIC', 'Epic', 'Large feature spanning multiple issues', ['epic', 'large', 'umbrella'])",
    CreateTypeSchema
  ),
  createToolDefinition(
    "update_type",
    "Update an existing type's displayName, description, keywords, or color. Cannot change the type name - delete and recreate instead.",
    UpdateTypeSchema
  ),
  createToolDefinition(
    "delete_type",
    "Soft-delete a type. The type will no longer be available for new issues/tasks, but existing records referencing it will be preserved. Even default types (FEATURE, BUG, etc.) can be deleted.",
    DeleteTypeSchema
  ),
];

// =============================================================================
// Dispatch Tool Definitions
// =============================================================================

export const dispatchToolDefinitions = [
  createToolDefinition(
    "dispatch_task",
    "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Add a task to the dispatch queue for worker execution. Workers will poll and claim tasks from this queue. Idempotent - returns existing entry if task is already queued. Use this instead of load_task_session when you want a background worker to pick up the task.",
    DispatchTaskSchema
  ),
  createToolDefinition(
    "get_dispatch_status",
    "Get status of worker sessions and dispatch queue. Workers are Claude instances polling for tasks - NOT git worktrees (use list_worktrees for that). Returns: (1) all registered workers with status (IDLE/WORKING/DRAINING), isAlive, and currentTaskId; (2) worker summary counts (total, idle, working, draining); (3) dispatch queue entries showing which tasks are pending or being worked on; (4) queue stats (total, unclaimed, claimed, stale).",
    GetDispatchStatusSchema
  ),
  createToolDefinition(
    "end_worker_session",
    "Signal that the Claude worker session is complete. This is the TERMINAL action for worker tasks - nothing should be done after calling this. Sets the claudeDone flag which workers poll for before terminating. Think of this like process.exit() - there is no 'after'. Must be called after complete_task or abandon_task.",
    EndWorkerSessionSchema
  ),
];

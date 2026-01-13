/**
 * Shared Zod schemas for MCP tool input validation
 *
 * This module defines Zod schemas for all MCP tools. The schemas serve two purposes:
 * 1. Generate JSON Schema for tool definitions (via zod-to-json-schema)
 * 2. Validate and type tool arguments at runtime
 *
 * Key patterns:
 * - Use .strict() on update objects to reject unknown properties
 * - Use z.infer<typeof Schema> for typed handler arguments
 * - Schemas are named {ToolName}Schema (e.g., CreateIssueSchema)
 */

import { z } from "zod";

// =============================================================================
// Shared Enums
// =============================================================================

export const IssueTypeEnum = z.enum(["FEATURE", "BUG", "ENHANCEMENT", "TASK"]);
export const IssuePriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const IssueStatusEnum = z.enum(["PLANNED", "OPEN", "IN_PROGRESS", "CLOSED"]);
export const TaskStatusEnum = z.enum([
  "PLANNED",
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "PR_REVIEW",
  "COMPLETED",
  "ABANDONED",
]);
export const TemplateCategoryEnum = z.enum(["issue", "task"]);
export const TemplateScopeEnum = z.enum(["local", "global", "all"]);
export const ExecutionModeEnum = z.enum(["isolated", "branch", "main"]);
export const PlanComplexityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
export const SettingsActionEnum = z.enum([
  "get_settings",
  "enable_github",
  "disable_github",
  "configure_github",
  "configure_column_mapping",
  "list_available_labels",
]);
export const MergeIssuesModeEnum = z.enum(["create_new", "merge_into"]);

// =============================================================================
// Shared Types
// =============================================================================

/** Labels as key-value pairs. Empty string = simple tag. */
export const LabelsSchema = z.record(z.string(), z.string());

// =============================================================================
// Issue Tool Schemas
// =============================================================================

export const CreateIssueSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Detailed description of the issue"),
  acceptanceCriteria: z.array(z.string()).optional().describe("List of acceptance criteria"),
  type: IssueTypeEnum.optional().describe("Issue type"),
  priority: IssuePriorityEnum.optional().describe("Issue priority"),
  useTemplate: z.boolean().optional().describe("Auto-select template based on description"),
  labels: LabelsSchema.optional().describe(
    'Labels for this issue. Supports simple labels (empty value) and key-value pairs. Example: {"bug": "", "product": "Case Workflow"}'
  ),
});

export const GetIssueSchema = z.object({
  id: z.string().optional().describe("Issue UUID"),
  issueNumber: z.number().optional().describe("Issue number (e.g., 123 for #123)"),
  includePlan: z
    .boolean()
    .optional()
    .describe("Include the plan with slim task list (default: false)"),
});

export const DeleteIssueSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const RestoreIssueSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const ListTemplatesSchema = z.object({
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates from .track/templates/tasks/"
  ),
  scope: TemplateScopeEnum.optional().describe(
    "Filter by template scope: 'global' for ~/.track/templates/, 'local' for .track/templates/, 'all' for both (default: all)"
  ),
  type: z
    .string()
    .optional()
    .describe(
      "Filter by template type (e.g., 'FEATURE', 'BUG'). Returns only templates of the specified type."
    ),
});

export const GetTemplateSchema = z.object({
  filename: z.string().describe("Template filename (e.g., 'feature.md', 'bug.md')"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/), 'global' for user templates (~/.track/templates/). If not specified, searches local first then global."
    ),
});

export const CreateTemplateSchema = z.object({
  filename: z.string().describe("Template filename (must end with .md)"),
  content: z
    .string()
    .describe(
      "Template content in markdown with YAML frontmatter. Example: '---\\ntype: FEATURE\\npriority: MEDIUM\\n---\\n# Description\\n...'"
    ),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const UpdateTemplateSchema = z.object({
  filename: z.string().describe("Template filename"),
  content: z.string().describe("New template content in markdown with YAML frontmatter"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const DeleteTemplateSchema = z.object({
  filename: z.string().describe("Template filename to delete"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const CopyTemplateSchema = z.object({
  filename: z.string().describe("Template filename to copy (e.g., 'feature.md')"),
  category: TemplateCategoryEnum.describe(
    "Template category: 'issue' for issue templates, 'task' for task templates"
  ),
  fromScope: z.enum(["local", "global"]).describe("Source scope to copy from"),
  toScope: z.enum(["local", "global"]).describe("Destination scope to copy to"),
});

// Use .strict() on updates object to reject unknown properties like 'status'
export const UpdateIssueSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
  updates: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      type: IssueTypeEnum.optional(),
      priority: IssuePriorityEnum.optional(),
      labels: LabelsSchema.optional().describe(
        "Update labels. Supports simple labels (empty value) and key-value pairs. Pass null to clear all labels."
      ),
    })
    .strict()
    .describe("Fields to update on the issue"),
  regeneratePlan: z
    .boolean()
    .optional()
    .describe("Automatically regenerate plan after update (default: false)"),
});

export const CloseIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass task state validation. Use when issue state has drifted (e.g., all work is done but some tasks weren't marked complete). Requires user confirmation before use."
    ),
});

export const ChangeIssueTypeSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  type: z
    .string()
    .describe(
      "New issue type. Defaults: FEATURE, BUG, ENHANCEMENT, TASK. Custom types can be defined in ./.track/types.md"
    ),
});

export const GetProjectStatsSchema = z.object({});

export const SearchIssuesSchema = z.object({
  query: z.string().describe("Search query (case-insensitive)"),
});

export const GetWorkQueueSchema = z.object({});

export const ImportGitHubIssueSchema = z.object({
  githubIssueNumber: z.number().optional().describe("GitHub issue number to import (e.g., 42)"),
  githubIssueUrl: z
    .string()
    .optional()
    .describe(
      "GitHub issue URL to import (e.g., https://github.com/owner/repo/issues/42). Alternative to githubIssueNumber."
    ),
});

// =============================================================================
// Plan Tool Schemas
// =============================================================================

export const TaskDefinitionSchema = z.object({
  id: z
    .string()
    .describe(
      "Short placeholder ID for this task (e.g., 'db', 'api', 'auth'). Used to reference this task in dependsOn. Real UUIDs are generated internally."
    ),
  title: z.string(),
  description: z.string(),
  type: z
    .string()
    .describe(
      "Task type (FEATURE, BUG, ENHANCEMENT, TASK, or custom). REQUIRED. Call list_types first to get valid values. Type determines the GitHub label applied when task is synced."
    ),
  acceptanceCriteria: z.array(z.string()).optional(),
  estimatedMinutes: z.number().optional(),
  implementationPlan: z
    .string()
    .optional()
    .describe(
      "Technical implementation details for task execution (e.g., specific patterns to use, file locations). This is for Claude's execution context and is NOT synced to GitHub issues."
    ),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe(
      "Array of placeholder IDs this task depends on. References must match 'id' values of other tasks in this plan."
    ),
});

export const GeneratePlanSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
  summary: z.string().describe("Brief summary of the plan"),
  approach: z.string().describe("Detailed implementation approach (markdown)"),
  tasks: z
    .array(TaskDefinitionSchema)
    .describe(
      "Array of task definitions. Use short placeholder IDs (e.g., 'db', 'api') and reference them in 'dependsOn'. Real UUIDs are generated internally. Each task MUST include a valid 'type' - call list_types first."
    ),
  estimatedComplexity: PlanComplexityEnum.describe("Estimated complexity of the plan"),
});

export const GetPlanSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const PauseIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

export const MoveIssueToReadySchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

export const MoveIssueToBacklogSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  skipGitHubSync: z
    .boolean()
    .optional()
    .describe(
      "Skip GitHub issue creation even if GitHub sync is enabled. Tasks will still transition to BACKLOG but without creating GitHub issues. Useful for internal issues that don't need GitHub visibility. Default: false."
    ),
});

export const SyncIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

// =============================================================================
// Task Tool Schemas
// =============================================================================

export const LoadTaskSessionSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  mode: ExecutionModeEnum.optional().describe(
    "Execution mode. ALWAYS use 'isolated' (default) unless user explicitly requests otherwise. 'branch': only if user says 'branch mode' or 'no worktree'. 'main': only if user explicitly says 'on main', 'main mode', or 'skip PR'."
  ),
  workerId: z
    .string()
    .optional()
    .describe(
      "Worker UUID. When provided, enforces isolated mode - fails if mode is not 'isolated'. Workers MUST pass their workerId to prevent accidental use of non-isolated modes."
    ),
});

export const AbandonTaskSessionSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  reason: z.string().optional().describe("Reason for abandonment"),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass session ownership validation. Use when task state has drifted (e.g., session expired but task is still IN_PROGRESS). Requires user confirmation before use."
    ),
});

export const GetTaskSchema = z.object({
  taskId: z.string().optional().describe("Task UUID"),
  taskNumber: z.number().optional().describe("Task number within the issue (e.g., 1, 2, 3)"),
  issueNumber: z.number().optional().describe("Issue number (required when using taskNumber)"),
});

export const ListAvailableTasksSchema = z.object({
  planId: z.string().optional().describe("Filter by plan UUID"),
  issueNumber: z.number().optional().describe("Filter by issue number"),
});

export const DeleteTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

// Use .strict() on the full object since all properties are explicitly defined
export const UpdateTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  title: z.string().optional().describe("New task title"),
  description: z.string().optional().describe("New task description"),
  acceptanceCriteria: z.array(z.string()).optional().describe("New acceptance criteria"),
  estimatedMinutes: z.number().optional().describe("Estimated time in minutes"),
  implementationPlan: z
    .string()
    .optional()
    .describe(
      "Technical implementation details for task execution (e.g., specific patterns to use, file locations)"
    ),
  labels: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe(
      'Task labels as key-value pairs. Empty string = simple tag, non-empty = value. To remove a label, set its value to null. Example: { "urgent": "", "product": "Case Workflow" }'
    ),
});

export const GetTaskExecutionPromptSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const LogTaskProgressSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Session ID executing the task"),
  message: z.string().describe("What was done (e.g., 'Created user model in src/models/user.ts')"),
  filesModified: z.array(z.string()).optional().describe("Optional list of files touched"),
});

export const GetTaskExecutionLogSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const CheckTaskConflictsSchema = z.object({
  taskId: z.string().describe("Task UUID to check for conflicts"),
});

// =============================================================================
// Snapshot Tool Schemas
// =============================================================================

export const GetSnapshotHistorySchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const RevertToSnapshotSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  version: z.number().describe("Version number to revert to"),
  notes: z.string().optional().describe("Reason for reversion"),
});

export const ViewSnapshotSchema = z.object({
  issueNumber: z.number().describe("Issue number"),
  version: z.number().describe("Version number to view"),
});

// =============================================================================
// Settings Tool Schemas
// =============================================================================

export const ColumnMappingSchema = z.object({
  PLANNED: z.string().optional(),
  BACKLOG: z.string().optional(),
  READY: z.string().optional(),
  IN_PROGRESS: z.string().optional(),
  PR_REVIEW: z.string().optional(),
  COMPLETED: z.string().optional(),
  ABANDONED: z.string().optional(),
});

export const GitHubLabelsConfigSchema = z.object({
  typeLabels: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Maps issue types to GitHub labels. Keys must be valid type names (call list_types to see available types). Example: { FEATURE: 'feature', BUG: 'bug' }"
    ),
  customLabels: z
    .array(z.string())
    .optional()
    .describe("Additional labels applied to all synced issues"),
});

export const GitHubConfigSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe("GitHub Project ID for Projects integration (optional, format: PVT_...)"),
  assignee: z
    .string()
    .optional()
    .describe(
      "GitHub username to auto-assign issues when task enters IN_PROGRESS. Do not include @ prefix. Pass empty string to clear."
    ),
  labels: GitHubLabelsConfigSchema.optional().describe("Label configuration for GitHub issues"),
  columnMapping: ColumnMappingSchema.optional().describe(
    "Maps task statuses to project board column names. Only specify the statuses you want to override. Default: BACKLOG→Backlog, READY→Ready, IN_PROGRESS→In Progress, PR_REVIEW→In Review, COMPLETED→Done, ABANDONED→Done"
  ),
});

export const UpdateSettingsSchema = z.object({
  action: SettingsActionEnum.describe(
    "The settings action to perform: get_settings returns current config, enable_github enables GitHub issue sync with validation, disable_github disables issue sync, configure_github updates labels/projectId config, configure_column_mapping updates status-to-column mapping for project boards, list_available_labels returns available label fields from the project management provider"
  ),
  github: GitHubConfigSchema.optional().describe(
    "GitHub configuration options (projectId, assignee, labels, columnMapping)"
  ),
  resetColumnMapping: z
    .boolean()
    .optional()
    .describe(
      "For configure_column_mapping action: reset column mapping to defaults. If true, ignores columnMapping parameter and resets to default values."
    ),
});

// =============================================================================
// Milestone Tool Schemas
// =============================================================================

export const CreateMilestoneSchema = z.object({
  title: z.string().describe("Milestone title"),
  description: z.string().optional().describe("Milestone description"),
  startDate: z.string().describe("Start date in YYYY-MM-DD format"),
  endDate: z.string().describe("End date in YYYY-MM-DD format"),
});

export const GetMilestoneSchema = z.object({
  id: z.string().optional().describe("Milestone UUID"),
  milestoneNumber: z.number().optional().describe("Milestone number (e.g., 1 for M1)"),
});

export const ListMilestonesSchema = z.object({
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"])
    .optional()
    .describe("Filter by computed status"),
});

export const UpdateMilestoneSchema = z.object({
  milestoneNumber: z.number().describe("Milestone number (e.g., 1 for M1)"),
  updates: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z
        .enum(["COMPLETED"])
        .optional()
        .describe(
          "Only COMPLETED can be set manually. Other statuses are computed from issue states."
        ),
    })
    .describe(
      "Fields to update. Status can only be set to COMPLETED (manual sign-off); other statuses are computed automatically."
    ),
});

export const DeleteMilestoneSchema = z.object({
  milestoneNumber: z.number().describe("Milestone number (e.g., 1 for M1)"),
});

export const AssignIssueToMilestoneSchema = z.object({
  issueNumber: z.number().describe("Issue number to assign"),
  milestoneNumber: z.number().describe("Milestone number to assign to"),
});

export const RemoveIssueFromMilestoneSchema = z.object({
  issueNumber: z.number().describe("Issue number to remove from milestone"),
});

// =============================================================================
// Worktree Tool Schemas
// =============================================================================

export const ListWorktreesSchema = z.object({});

export const PruneStaleWorktreesSchema = z.object({});

// =============================================================================
// PR Tool Schemas
// =============================================================================

export const GetTaskPRStatusSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const CreatePRSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  title: z
    .string()
    .optional()
    .describe(
      "PR title. Defaults to '[#N] taskTitle' where N is the task's linked GitHub issue number. Plain 'taskTitle' if task has no GitHub issue."
    ),
  body: z
    .string()
    .optional()
    .describe("PR body/description. GitHub issue linking is automatically added."),
  draft: z.boolean().optional().describe("Create as draft PR (default: false)"),
  baseBranch: z.string().optional().describe("Target branch for the PR (default: main)"),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass status validation. Use when task state has drifted (e.g., branch already pushed but task not in IN_PROGRESS). Claude MUST ask user permission before using force=true."
    ),
});

export const SubmitForReviewSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass status/PR validation. Use when task state has drifted (e.g., task already in PR_REVIEW but needs re-sync). Claude MUST ask user permission before using force=true."
    ),
});

export const CompleteTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  finalLogEntry: z
    .string()
    .describe(
      "Required summary of what was accomplished in this task. This is written to the task execution log before completing."
    ),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass state machine validation. Use when task state has drifted from reality (e.g., task is IN_PROGRESS but PR is already merged). Requires user confirmation before use."
    ),
  autoCloseIssue: z
    .boolean()
    .optional()
    .describe(
      "When true, automatically close the parent issue if all tasks are now in terminal state (COMPLETED or ABANDONED). Default: false. Claude should ask user permission before using this."
    ),
});

// =============================================================================
// Merge Tool Schemas
// =============================================================================

export const MergeIssuesSchema = z.object({
  sourceIssueNumber: z
    .number()
    .describe("Issue number of the source issue (the one being merged from)"),
  targetIssueNumber: z
    .number()
    .describe("Issue number of the target issue (in merge_into mode, source folds into this)"),
  mode: MergeIssuesModeEnum.describe(
    "'create_new': Create a new issue from both (originals unchanged). 'merge_into': Fold source into target (source is soft-deleted)."
  ),
  newTitle: z
    .string()
    .optional()
    .describe("Custom title for the merged issue (create_new mode only, optional)"),
  newDescription: z
    .string()
    .optional()
    .describe("Custom description for the merged issue (create_new mode only, optional)"),
});

// =============================================================================
// Type Tool Schemas
// =============================================================================

export const ListTypesSchema = z.object({});

export const CreateTypeSchema = z.object({
  name: z
    .string()
    .describe(
      "Uppercase type name (e.g., 'EPIC', 'TECH_DEBT'). Must be uppercase letters, numbers, and underscores."
    ),
  displayName: z.string().describe("Human-readable display name (e.g., 'Epic', 'Tech Debt')"),
  description: z.string().describe("Description explaining when to use this type"),
  keywords: z
    .array(z.string())
    .optional()
    .describe("Keywords for intelligent type selection (optional)"),
  color: z.string().optional().describe("Optional UI color (hex string, e.g., '#ff0000')"),
});

export const UpdateTypeSchema = z.object({
  name: z.string().describe("Type name to update (e.g., 'FEATURE')"),
  updates: z
    .object({
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
      keywords: z.array(z.string()).optional().describe("New keywords array"),
      color: z.string().nullable().optional().describe("New color (or null to clear)"),
    })
    .describe("Fields to update"),
});

export const DeleteTypeSchema = z.object({
  name: z.string().describe("Type name to delete (e.g., 'SPIKE')"),
});

// =============================================================================
// Dispatch Tool Schemas
// =============================================================================

export const DispatchTaskSchema = z.object({
  taskId: z.string().describe("Task UUID to dispatch to workers"),
});

export const GetDispatchStatusSchema = z.object({});

export const EndWorkerSessionSchema = z.object({
  workerId: z.string().describe("Worker UUID (provided in the worker prompt)"),
  taskId: z.string().describe("Task UUID that was being worked on"),
});

// =============================================================================
// Schema Registry - Maps tool names to their validation schemas
// =============================================================================

export const toolSchemas = {
  // Issue tools
  create_issue: CreateIssueSchema,
  get_issue: GetIssueSchema,
  delete_issue: DeleteIssueSchema,
  restore_issue: RestoreIssueSchema,
  list_templates: ListTemplatesSchema,
  get_template: GetTemplateSchema,
  create_template: CreateTemplateSchema,
  update_template: UpdateTemplateSchema,
  delete_template: DeleteTemplateSchema,
  copy_template: CopyTemplateSchema,
  update_issue: UpdateIssueSchema,
  close_issue: CloseIssueSchema,
  change_issue_type: ChangeIssueTypeSchema,
  get_project_stats: GetProjectStatsSchema,
  search_issues: SearchIssuesSchema,
  get_work_queue: GetWorkQueueSchema,
  import_github_issue: ImportGitHubIssueSchema,
  // Plan tools
  generate_plan: GeneratePlanSchema,
  get_plan: GetPlanSchema,
  pause_issue: PauseIssueSchema,
  move_issue_to_ready: MoveIssueToReadySchema,
  move_issue_to_backlog: MoveIssueToBacklogSchema,
  sync_issue: SyncIssueSchema,
  // Task tools
  load_task_session: LoadTaskSessionSchema,
  abandon_task_session: AbandonTaskSessionSchema,
  get_task: GetTaskSchema,
  list_available_tasks: ListAvailableTasksSchema,
  delete_task: DeleteTaskSchema,
  update_task: UpdateTaskSchema,
  get_task_execution_prompt: GetTaskExecutionPromptSchema,
  log_task_progress: LogTaskProgressSchema,
  get_task_execution_log: GetTaskExecutionLogSchema,
  check_task_conflicts: CheckTaskConflictsSchema,
  // Snapshot tools
  get_snapshot_history: GetSnapshotHistorySchema,
  revert_to_snapshot: RevertToSnapshotSchema,
  view_snapshot: ViewSnapshotSchema,
  // Settings tools
  update_settings: UpdateSettingsSchema,
  // Milestone tools
  create_milestone: CreateMilestoneSchema,
  get_milestone: GetMilestoneSchema,
  list_milestones: ListMilestonesSchema,
  update_milestone: UpdateMilestoneSchema,
  delete_milestone: DeleteMilestoneSchema,
  assign_issue_to_milestone: AssignIssueToMilestoneSchema,
  remove_issue_from_milestone: RemoveIssueFromMilestoneSchema,
  // Worktree tools
  list_worktrees: ListWorktreesSchema,
  prune_stale_worktrees: PruneStaleWorktreesSchema,
  // PR tools
  get_task_pr_status: GetTaskPRStatusSchema,
  create_pr: CreatePRSchema,
  submit_for_review: SubmitForReviewSchema,
  complete_task: CompleteTaskSchema,
  // Merge tools
  merge_issues: MergeIssuesSchema,
  // Type tools
  list_types: ListTypesSchema,
  create_type: CreateTypeSchema,
  update_type: UpdateTypeSchema,
  delete_type: DeleteTypeSchema,
  // Dispatch tools
  dispatch_task: DispatchTaskSchema,
  get_dispatch_status: GetDispatchStatusSchema,
  end_worker_session: EndWorkerSessionSchema,
} as const;

export type ToolName = keyof typeof toolSchemas;

// =============================================================================
// Type inference helpers
// =============================================================================

export type CreateIssueArgs = z.infer<typeof CreateIssueSchema>;
export type GetIssueArgs = z.infer<typeof GetIssueSchema>;
export type DeleteIssueArgs = z.infer<typeof DeleteIssueSchema>;
export type RestoreIssueArgs = z.infer<typeof RestoreIssueSchema>;
export type ListTemplatesArgs = z.infer<typeof ListTemplatesSchema>;
export type GetTemplateArgs = z.infer<typeof GetTemplateSchema>;
export type CreateTemplateArgs = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateArgs = z.infer<typeof UpdateTemplateSchema>;
export type DeleteTemplateArgs = z.infer<typeof DeleteTemplateSchema>;
export type CopyTemplateArgs = z.infer<typeof CopyTemplateSchema>;
export type UpdateIssueArgs = z.infer<typeof UpdateIssueSchema>;
export type CloseIssueArgs = z.infer<typeof CloseIssueSchema>;
export type ChangeIssueTypeArgs = z.infer<typeof ChangeIssueTypeSchema>;
export type SearchIssuesArgs = z.infer<typeof SearchIssuesSchema>;
export type ImportGitHubIssueArgs = z.infer<typeof ImportGitHubIssueSchema>;
export type GeneratePlanArgs = z.infer<typeof GeneratePlanSchema>;
export type GetPlanArgs = z.infer<typeof GetPlanSchema>;
export type PauseIssueArgs = z.infer<typeof PauseIssueSchema>;
export type MoveIssueToReadyArgs = z.infer<typeof MoveIssueToReadySchema>;
export type MoveIssueToBacklogArgs = z.infer<typeof MoveIssueToBacklogSchema>;
export type SyncIssueArgs = z.infer<typeof SyncIssueSchema>;
export type LoadTaskSessionArgs = z.infer<typeof LoadTaskSessionSchema>;
export type AbandonTaskSessionArgs = z.infer<typeof AbandonTaskSessionSchema>;
export type GetTaskArgs = z.infer<typeof GetTaskSchema>;
export type ListAvailableTasksArgs = z.infer<typeof ListAvailableTasksSchema>;
export type DeleteTaskArgs = z.infer<typeof DeleteTaskSchema>;
export type UpdateTaskArgs = z.infer<typeof UpdateTaskSchema>;
export type GetTaskExecutionPromptArgs = z.infer<typeof GetTaskExecutionPromptSchema>;
export type LogTaskProgressArgs = z.infer<typeof LogTaskProgressSchema>;
export type GetTaskExecutionLogArgs = z.infer<typeof GetTaskExecutionLogSchema>;
export type CheckTaskConflictsArgs = z.infer<typeof CheckTaskConflictsSchema>;
export type GetSnapshotHistoryArgs = z.infer<typeof GetSnapshotHistorySchema>;
export type RevertToSnapshotArgs = z.infer<typeof RevertToSnapshotSchema>;
export type ViewSnapshotArgs = z.infer<typeof ViewSnapshotSchema>;
export type UpdateSettingsArgs = z.infer<typeof UpdateSettingsSchema>;
export type CreateMilestoneArgs = z.infer<typeof CreateMilestoneSchema>;
export type GetMilestoneArgs = z.infer<typeof GetMilestoneSchema>;
export type ListMilestonesArgs = z.infer<typeof ListMilestonesSchema>;
export type UpdateMilestoneArgs = z.infer<typeof UpdateMilestoneSchema>;
export type DeleteMilestoneArgs = z.infer<typeof DeleteMilestoneSchema>;
export type AssignIssueToMilestoneArgs = z.infer<typeof AssignIssueToMilestoneSchema>;
export type RemoveIssueFromMilestoneArgs = z.infer<typeof RemoveIssueFromMilestoneSchema>;
export type GetTaskPRStatusArgs = z.infer<typeof GetTaskPRStatusSchema>;
export type CreatePRArgs = z.infer<typeof CreatePRSchema>;
export type SubmitForReviewArgs = z.infer<typeof SubmitForReviewSchema>;
export type CompleteTaskArgs = z.infer<typeof CompleteTaskSchema>;
export type MergeIssuesArgs = z.infer<typeof MergeIssuesSchema>;
export type CreateTypeArgs = z.infer<typeof CreateTypeSchema>;
export type UpdateTypeArgs = z.infer<typeof UpdateTypeSchema>;
export type DeleteTypeArgs = z.infer<typeof DeleteTypeSchema>;
export type DispatchTaskArgs = z.infer<typeof DispatchTaskSchema>;
export type EndWorkerSessionArgs = z.infer<typeof EndWorkerSessionSchema>;

/**
 * @dev-workflow/tracking - Issue tracking domain package
 *
 * Re-exports commonly used types and services for convenience.
 * For better tree-shaking, import directly from submodules.
 */

// =============================================================================
// Data Access
// =============================================================================
export { DbSourceProvider } from "./data-access/db-source-provider.js";
export type { DbSource } from "./data-access/db-source.js";
export type { DbClient } from "./data-access/db-client.js";
export { DrizzleDbClient } from "./data-access/drizzle-db-client.js";
export { DatabaseFactory } from "./data-access/database-factory.js";
export { runSqliteMigrations, checkpointSqliteDatabase } from "./data-access/sqlite-utils.js";

// =============================================================================
// Domain Types
// =============================================================================
export { Issue } from "./domain/issues/issue.js";
export type {
  IssueType,
  IssuePriority,
  IssueStatus,
  CloseCheck,
  CreateIssueParams,
  UpdateIssueParams,
} from "./domain/issues/issue.js";
export type { IssueRepository } from "./domain/issues/issue.js";

export { Task } from "./domain/tasks/task.js";
export type {
  TaskStatus,
  TaskSource,
  PRStatus,
  TaskRepository,
  TaskStatusHistory,
  TaskExecutionLog,
  TransitionCheck,
  CreateTaskParams,
  UpdateTaskParams,
} from "./domain/tasks/task.js";

export type { Plan, PlanComplexity, PlanRepository } from "./domain/plans/plan.js";
export { Milestone } from "./domain/milestones/milestone.js";
export type {
  MilestoneRepository,
  MilestoneIssueStats,
  DateValidation,
  CreateMilestoneParams,
  UpdateMilestoneParams,
} from "./domain/milestones/milestone.js";
export type { ComputedIssueStatus } from "./domain/issues/issue.js";
export type { Project, ProjectRepository } from "./domain/projects/project.js";
export type { Snapshot, SnapshotType } from "./domain/snapshots/snapshot.js";
export type { TypeDefinition, TypeRepository } from "./domain/types/type-definition.js";
export { DEFAULT_TYPE_DEFINITIONS } from "./domain/types/type-definition.js";

// =============================================================================
// Services
// =============================================================================
export { IssueStatusService, type TaskCounts } from "./domain/issues/issue-status-service.js";
// TaskService removed - use TaskDomainService + operation functions instead
export {
  matchTasks,
  type TaskDefinition,
  type TaskMatchResult,
} from "./domain/tasks/task-matching.js";
// PlanService, PlanningService, DependencyService removed - use PlanDomainService instead
export { validateDAG, getTopologicalOrder, type DAGNode } from "./domain/plans/dag-validation.js";
// MilestoneService removed - use MilestoneDomainService instead
export { VersioningService } from "./domain/snapshots/versioning-service.js";
export { TypeDomainService } from "./domain/types/type-service.js";
export {
  MergeService,
  MergeValidationError,
  type MergeResult,
  type MergeWarning,
  type MergeMode,
} from "./domain/issues/merge-service.js";
export {
  ConflictDetectionService,
  type ConflictWarning,
  type ConflictDetectionResult,
} from "./conflict-detection-service.js";
export {
  ProjectsResolver,
  resolveConfig,
  resolveConfigFromGit,
  writeConfig,
  ProjectConfigError,
  type ProjectConfigErrorCode,
  type ProjectConfig,
  type ProjectInfo,
  type SourceInfo,
} from "./domain/projects/projects-resolver.js";
export { ProjectService } from "./domain/projects/project-service.js";

// =============================================================================
// Templates
// =============================================================================
export { TemplateService, type TemplateServiceConfig } from "./templates/template-service.js";
export type { Template, TemplateMetadata } from "./template.js";

// =============================================================================
// File System
// =============================================================================
export type { FileSystem } from "./file-system/file-system.js";
export { NodeFileSystem } from "./file-system/file-system.js";

// =============================================================================
// Board / Queries
// =============================================================================
export {
  BoardQueryService,
  type BoardData,
  type BoardColumn,
  type BoardTask,
  type BoardIssueWithTasks,
  type WorkerCounts,
  type WorkerTaskAssignment,
} from "./board/board-query-service.js";

// =============================================================================
// Events
// =============================================================================
export { EventBus } from "./events/event-bus.js";
export type { AnyDomainEvent } from "./events.js";

// =============================================================================
// Domain Executor
// =============================================================================
export {
  DomainExecutorFactory,
  type DomainServices,
  type ProjectDomain,
} from "./domain/domain-executor.js";
export { IssueDomainService, type IssueSpec } from "./domain/issues/issue-domain-service.js";
export {
  TaskDomainService,
  type AddManualTaskRequest,
  type TaskSession,
} from "./domain/tasks/task-domain-service.js";
export {
  PlanDomainService,
  type GeneratePlanRequest,
  type RawTaskInput,
  type PlanWithTasks,
  type IssueUpdates,
} from "./domain/plans/plan-domain-service.js";
export {
  MilestoneDomainService,
  type MilestoneWithStatus,
} from "./domain/milestones/milestone-domain-service.js";
export {
  closeIssue,
  CloseIssueSchema,
  type CloseIssueInput,
  type CloseIssueResult as CloseIssueOperationResult,
} from "./operations/issues/close-issue.js";
export {
  deleteIssue,
  DeleteIssueSchema,
  type DeleteIssueInput,
} from "./operations/issues/delete-issue.js";
export {
  activateIssue,
  ActivateIssueSchema,
  type ActivateIssueInput,
  type ActivateIssueResult,
} from "./operations/issues/activate-issue.js";
export {
  moveIssueTasks,
  moveIssueTasksSchema,
  type MoveIssueTasksInput,
  type MoveIssueTasksResult,
} from "./operations/issues/move-issue-tasks.js";
export {
  transitionTask,
  transitionTaskSchema,
  type TransitionTaskInput,
  type TransitionTaskResult,
} from "./operations/tasks/transition-task.js";
export {
  abandonTask,
  abandonTaskSchema,
  type AbandonTaskInput,
  type AbandonTaskResult as AbandonTaskOperationResult,
} from "./operations/tasks/abandon-task.js";
export {
  getIssueDetails,
  GetIssueDetailsSchema,
  type GetIssueDetailsInput,
  type GetIssueDetailsResult,
} from "./operations/issues/get-issue-details.js";
export { validateInput } from "./operations/validation.js";
export { listTypes, type ListTypesResult, type TypeInfo } from "./operations/types/list-types.js";
export {
  createType,
  CreateTypeSchema as CreateTypeOperationSchema,
  type CreateTypeInput,
  type CreateTypeResult,
} from "./operations/types/create-type.js";
export {
  updateType,
  UpdateTypeSchema as UpdateTypeOperationSchema,
  type UpdateTypeInput,
  type UpdateTypeResult,
} from "./operations/types/update-type.js";
export {
  deleteType,
  DeleteTypeSchema as DeleteTypeOperationSchema,
  type DeleteTypeInput,
  type DeleteTypeResult,
} from "./operations/types/delete-type.js";

export { listWorktrees, type ListWorktreesResult } from "./operations/worktrees/list-worktrees.js";
export {
  pruneStaleWorktrees,
  type PruneStaleWorktreesResult,
} from "./operations/worktrees/prune-stale-worktrees.js";
export {
  mergeIssues,
  MergeIssuesSchema as MergeIssuesOperationSchema,
  type MergeIssuesInput,
  type MergeIssuesResult as MergeIssuesOperationResult,
} from "./operations/issues/merge-issues.js";
export {
  getSnapshotHistory,
  GetSnapshotHistorySchema as GetSnapshotHistoryOperationSchema,
  type GetSnapshotHistoryInput,
} from "./operations/snapshots/get-snapshot-history.js";
export {
  revertToSnapshot,
  RevertToSnapshotSchema as RevertToSnapshotOperationSchema,
  type RevertToSnapshotInput,
} from "./operations/snapshots/revert-to-snapshot.js";
export {
  viewSnapshot,
  ViewSnapshotSchema as ViewSnapshotOperationSchema,
  type ViewSnapshotInput,
} from "./operations/snapshots/view-snapshot.js";
export {
  createMilestone,
  CreateMilestoneSchema as CreateMilestoneOperationSchema,
  type CreateMilestoneInput,
  type CreateMilestoneResult,
} from "./operations/milestones/create-milestone.js";
export {
  getMilestone,
  GetMilestoneSchema as GetMilestoneOperationSchema,
  type GetMilestoneInput,
  type GetMilestoneResult,
} from "./operations/milestones/get-milestone.js";
export {
  listMilestones,
  ListMilestonesSchema as ListMilestonesOperationSchema,
  type ListMilestonesInput,
  type ListMilestonesResult,
} from "./operations/milestones/list-milestones.js";
export {
  updateMilestone,
  UpdateMilestoneSchema as UpdateMilestoneOperationSchema,
  type UpdateMilestoneInput,
  type UpdateMilestoneResult,
} from "./operations/milestones/update-milestone.js";
export {
  deleteMilestone,
  DeleteMilestoneSchema as DeleteMilestoneOperationSchema,
  type DeleteMilestoneInput,
  type DeleteMilestoneResult,
} from "./operations/milestones/delete-milestone.js";
export {
  assignIssueToMilestone,
  AssignIssueToMilestoneSchema as AssignIssueToMilestoneOperationSchema,
  type AssignIssueToMilestoneInput,
  type AssignIssueToMilestoneResult,
} from "./operations/milestones/assign-issue-to-milestone.js";
export {
  removeIssueFromMilestone,
  RemoveIssueFromMilestoneSchema as RemoveIssueFromMilestoneOperationSchema,
  type RemoveIssueFromMilestoneInput,
  type RemoveIssueFromMilestoneResult,
} from "./operations/milestones/remove-issue-from-milestone.js";
export {
  getDispatchStatus,
  type DispatchStatus,
} from "./operations/dispatch/get-dispatch-status.js";
export {
  dispatchTask,
  DispatchTaskSchema as DispatchTaskOperationSchema,
  type DispatchTaskInput,
  type DispatchTaskResult,
} from "./operations/dispatch/dispatch-task.js";
export {
  endWorkerSession,
  EndWorkerSessionSchema as EndWorkerSessionOperationSchema,
  type EndWorkerSessionInput,
  type EndWorkerSessionResult,
} from "./operations/dispatch/end-worker-session.js";
export {
  generatePlan,
  GeneratePlanSchema as GeneratePlanOperationSchema,
  type GeneratePlanInput,
  type GeneratePlanResult as GeneratePlanOperationResult,
} from "./operations/plans/generate-plan.js";
export {
  getPlan,
  GetPlanSchema as GetPlanOperationSchema,
  type GetPlanInput as GetPlanOperationInput,
  type GetPlanResult as GetPlanOperationResult,
} from "./operations/plans/get-plan.js";
export {
  pauseIssue,
  PauseIssueSchema as PauseIssueOperationSchema,
  type PauseIssueInput,
  type PauseIssueResult,
} from "./operations/plans/pause-issue.js";
export {
  moveIssueToReady,
  MoveIssueToReadySchema as MoveIssueToReadyOperationSchema,
  type MoveIssueToReadyInput,
  type MoveIssueToReadyResult,
} from "./operations/plans/move-issue-to-ready.js";
export {
  moveIssueToBacklog,
  MoveIssueToBacklogSchema as MoveIssueToBacklogOperationSchema,
  type MoveIssueToBacklogInput,
  type MoveIssueToBacklogResult,
} from "./operations/plans/move-issue-to-backlog.js";
export {
  createIssue,
  CreateIssueSchema,
  type CreateIssueInput,
  type CreateIssueResult,
} from "./operations/issues/create-issue.js";
export {
  restoreIssue,
  RestoreIssueSchema,
  type RestoreIssueInput,
  type RestoreIssueResult,
} from "./operations/issues/restore-issue.js";
export {
  updateIssue,
  UpdateIssueSchema,
  type UpdateIssueInput,
  type UpdateIssueResult,
} from "./operations/issues/update-issue.js";
export {
  changeIssueType,
  ChangeIssueTypeSchema,
  type ChangeIssueTypeInput,
  type ChangeIssueTypeResult,
} from "./operations/issues/change-issue-type.js";
export {
  getProjectStats,
  GetProjectStatsSchema,
  type GetProjectStatsInput,
  type GetProjectStatsResult,
} from "./operations/issues/get-project-stats.js";
export {
  searchIssues,
  SearchIssuesSchema,
  type SearchIssuesInput,
  type SearchIssuesResult,
} from "./operations/issues/search-issues.js";
export {
  getWorkQueue,
  GetWorkQueueSchema,
  type GetWorkQueueInput,
  type GetWorkQueueResult,
} from "./operations/issues/get-work-queue.js";

export {
  loadTaskSession,
  loadTaskSessionSchema,
  type LoadTaskSessionInput,
  type LoadTaskSessionResult,
} from "./operations/tasks/load-task-session.js";
export {
  getTask,
  getTaskSchema,
  type GetTaskInput as GetTaskOperationInput,
  type EnrichedTaskData,
  type TaskWorkerInfo,
  type TaskPRInfo,
} from "./operations/tasks/get-task.js";
export {
  listAvailableTasks,
  listAvailableTasksSchema,
  type ListAvailableTasksInput,
  type ListAvailableTasksResult,
} from "./operations/tasks/list-available-tasks.js";
export {
  deleteTask,
  deleteTaskSchema,
  type DeleteTaskInput as DeleteTaskOperationInput,
  type DeleteTaskResult,
} from "./operations/tasks/delete-task.js";
export {
  updateTask,
  updateTaskSchema,
  type UpdateTaskInput as UpdateTaskOperationInput,
  type UpdateTaskResult,
} from "./operations/tasks/update-task.js";
export {
  getTaskExecutionPrompt,
  getTaskExecutionPromptSchema,
  type GetTaskExecutionPromptInput,
  type GetTaskExecutionPromptResult,
} from "./operations/tasks/get-task-execution-prompt.js";
export {
  logTaskProgress,
  logTaskProgressSchema,
  type LogTaskProgressInput,
  type LogTaskProgressResult,
} from "./operations/tasks/log-task-progress.js";
export {
  getTaskExecutionLog,
  getTaskExecutionLogSchema,
  type GetTaskExecutionLogInput,
  type GetTaskExecutionLogResult,
} from "./operations/tasks/get-task-execution-log.js";
export {
  checkTaskConflicts,
  checkTaskConflictsSchema,
  type CheckTaskConflictsInput,
  type CheckTaskConflictsResult,
} from "./operations/tasks/check-task-conflicts.js";

export {
  getTaskPRStatus,
  GetTaskPRStatusSchema,
  type GetTaskPRStatusInput,
  type GetTaskPRStatusResult,
} from "./operations/pr/get-task-pr-status.js";
export {
  createPR,
  CreatePRSchema,
  type CreatePRInput,
  type CreatePRResult,
} from "./operations/pr/create-pr.js";
export {
  submitForReview,
  SubmitForReviewSchema,
  type SubmitForReviewInput,
  type SubmitForReviewResult,
} from "./operations/pr/submit-for-review.js";
export {
  completeTask,
  CompleteTaskSchema,
  type CompleteTaskInput,
  type CompleteTaskResult,
} from "./operations/pr/complete-task.js";

export {
  listTemplates,
  ListTemplatesSchema,
  type ListTemplatesInput,
  type ListTemplatesResult,
} from "./operations/templates/list-templates.js";
export {
  getTemplate,
  GetTemplateSchema,
  type GetTemplateInput,
  type GetTemplateResult,
} from "./operations/templates/get-template.js";
export {
  createTemplate,
  CreateTemplateSchema,
  type CreateTemplateInput,
  type CreateTemplateResult,
} from "./operations/templates/create-template.js";
export {
  updateTemplate,
  UpdateTemplateSchema,
  type UpdateTemplateInput,
  type UpdateTemplateResult,
} from "./operations/templates/update-template.js";
export {
  deleteTemplate,
  DeleteTemplateSchema,
  type DeleteTemplateInput,
  type DeleteTemplateResult,
} from "./operations/templates/delete-template.js";
export {
  copyTemplate,
  CopyTemplateSchema,
  type CopyTemplateInput,
  type CopyTemplateResult,
} from "./operations/templates/copy-template.js";

// =============================================================================
// Service Tags (standalone tags for interface-based dependencies)
// =============================================================================
export { DbSourceTag } from "./data-access/db-source.js";
export { DbClientTag } from "./data-access/db-client.js";
export { ProjectTag } from "./domain/projects/project.js";

// =============================================================================
// DI / Infrastructure
// =============================================================================
export { compose, type Middleware } from "./di/compose.js";
export { mapError, type HttpErrorResponse, isDomainError } from "./di/map-error.js";
export { createTestContainer } from "./di/container.js";

// =============================================================================
// Errors
// =============================================================================
export {
  DomainError,
  EntityNotFoundError,
  ValidationError,
  ZodValidationError,
  ConflictError,
  BusinessRuleError,
  AuthenticationError,
  AuthorizationError,
  DependencyNotSatisfiedError,
} from "./domain/errors.js";

// =============================================================================
// Repositories (for direct access when needed)
// =============================================================================
export { DrizzleIssueRepository } from "./domain/issues/issue-repository.js";
export { DrizzleTaskRepository } from "./domain/tasks/task-repository.js";
export { DrizzlePlanRepository } from "./domain/plans/plan-repository.js";
export { DrizzleMilestoneRepository } from "./domain/milestones/milestone-repository.js";
export { DrizzleProjectRepository } from "./domain/projects/project-repository.js";
export { DrizzleTypeRepository } from "./domain/types/type-repository.js";
export { DrizzleSnapshotRepository } from "./domain/snapshots/snapshot-repository.js";

// =============================================================================
// Global Settings
// =============================================================================
export type { GlobalSettingsRepository } from "./domain/global-settings-repository.js";
export { DrizzleGlobalSettingsRepository } from "./domain/global-settings-repository.js";

// =============================================================================
// Execution Log
// =============================================================================
export type { ExecutionLog, ExecutionLogRepository } from "./domain/execution-log.js";
export { DrizzleExecutionLogRepository } from "./domain/execution-log-repository.js";

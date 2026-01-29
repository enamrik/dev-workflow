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
export type {
  Issue,
  IssueType,
  IssuePriority,
  IssueStatus,
  IssueRepository,
} from "./issues/issue.js";
export {
  isIssueClosed,
  isIssueInPlanning,
  isIssueDone,
  issueHasActiveWork,
} from "./issues/issue.js";

export type {
  Task,
  TaskStatus,
  TaskSource,
  PRStatus,
  TaskRepository,
  TaskStatusHistory,
  TaskExecutionLog,
} from "./tasks/task.js";
export { isTerminal, isActive, isWorkable, isValidStatusTransition } from "./tasks/task.js";

export type { Plan, PlanComplexity, PlanRepository } from "./plans/plan.js";
export type {
  Milestone,
  MilestoneRepository,
  MilestoneIssueStats,
} from "./milestones/milestone.js";
export { computeMilestoneStatus } from "./milestones/milestone.js";
export type { ComputedIssueStatus } from "./issues/issue.js";
export type { Project, ProjectRepository } from "./projects/project.js";
export type { Snapshot, SnapshotType } from "./snapshots/snapshot.js";
export type { TypeDefinition, TypeRepository } from "./types/type-definition.js";
export { DEFAULT_TYPE_DEFINITIONS } from "./types/type-definition.js";

// =============================================================================
// Services
// =============================================================================
export { IssueService, type CloseIssueResult } from "./issues/issue-service.js";
export {
  IssueStatusService,
  computeIssueStatus,
  type TaskCounts,
} from "./issues/issue-status-service.js";
export { TaskService, TaskServiceError, type AbandonTaskResult } from "./tasks/task-service.js";
export { TaskManagementService } from "./tasks/task-management-service.js";
export {
  TaskSessionService,
  type TaskSession,
  type StartTaskSessionRequest,
  type CompleteTaskSessionRequest,
  type TaskExecutionMode,
} from "./tasks/task-session-service.js";
export { TaskMatchingService } from "./tasks/task-matching-service.js";
export { PlanService } from "./plans/plan-service.js";
export { PlanningService, type GeneratePlanRequest } from "./plans/planning-service.js";
export { DependencyService } from "./plans/dependency-service.js";
export { DAGValidationService } from "./plans/dag-validation-service.js";
export { MilestoneService } from "./milestones/milestone-service.js";
export { VersioningService } from "./snapshots/versioning-service.js";
export { TypeService } from "./types/type-service.js";
export {
  MergeService,
  MergeValidationError,
  type MergeResult,
  type MergeWarning,
  type MergeMode,
} from "./issues/merge-service.js";
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
} from "./projects/projects-resolver.js";
export { ProjectService } from "./projects/project-service.js";

// =============================================================================
// Project Sync / External Providers
// =============================================================================
export type {
  ProjectManagementProvider,
  SyncState,
  AvailableLabel,
} from "./project-sync/project-management-provider.js";
export {
  PROVIDER_DEFAULT_COLUMN_MAPPING as DEFAULT_COLUMN_MAPPING,
  type ColumnMapping,
  type ProjectManagementConfig,
} from "./project-sync/project-management-config.js";
export type { ProjectManagementClient } from "./project-sync/project-management-client.js";
export { ProjectManagementService } from "./project-sync/project-management-service.js";
export {
  ProjectManagementRegistry,
  getProjectManagementProvider,
} from "./project-sync/provider-registry.js";
export { getProjectManagementService } from "./project-sync/provider-factory.js";
export type { GitHubCLI } from "./project-sync/github/github-cli.js";
export { NodeGitHubCLI } from "./project-sync/github/github-cli.js";
export { GitHubProjectManagementProvider } from "./project-sync/github/github-project-management-provider.js";
export { GitHubProjectManagementClient } from "./project-sync/github/github-project-management-client.js";
export { NoOpProjectManagementProvider } from "./project-sync/noop-project-management-provider.js";
export { NoOpProjectManagementClient } from "./project-sync/noop-project-management-client.js";
export {
  MockGitHubCLI,
  type MockGitHubCLIConfig,
  type MockGitHubCLICall,
} from "./project-sync/github/mock-github-cli.js";

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
} from "./errors.js";

// =============================================================================
// Repositories (for direct access when needed)
// =============================================================================
export { DrizzleIssueRepository } from "./issues/issue-repository.js";
export { DrizzleTaskRepository } from "./tasks/task-repository.js";
export { DrizzlePlanRepository } from "./plans/plan-repository.js";
export { DrizzleMilestoneRepository } from "./milestones/milestone-repository.js";
export { DrizzleProjectRepository } from "./projects/project-repository.js";
export { DrizzleTypeRepository } from "./types/type-repository.js";
export { DrizzleSnapshotRepository } from "./snapshots/snapshot-repository.js";

// =============================================================================
// Global Settings
// =============================================================================
export type { GlobalSettingsRepository } from "./global-settings-repository.js";
export { DrizzleGlobalSettingsRepository } from "./global-settings-repository.js";

// =============================================================================
// Backup
// =============================================================================
export { BackupService } from "./backup-service.js";
export type {
  BackupResult,
  BackupProvider,
  BackupMetadata,
  RestoreResult,
  ValidationResult,
  CreateBucketResult,
} from "./backup.js";
export { S3BackupProvider } from "./backup/s3-backup-provider.js";

// =============================================================================
// Execution Log
// =============================================================================
export type { ExecutionLog, ExecutionLogRepository } from "./execution-log.js";
export { DrizzleExecutionLogRepository } from "./execution-log-repository.js";

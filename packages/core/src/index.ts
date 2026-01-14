/**
 * @dev-workflow/core
 *
 * Core domain logic for dev-workflow.
 * Contains domain entities, application services, and infrastructure implementations.
 */

// Domain exports
export * from "./domain/issue.js";
export * from "./domain/plan.js";
export * from "./domain/task.js";
export * from "./domain/snapshot.js";
export * from "./domain/template.js";
export * from "./domain/events.js";
export * from "./domain/github.js";
export * from "./domain/project-management-provider.js";
export * from "./domain/project-management-config.js";
export * from "./domain/milestone.js";
export * from "./domain/project.js";
export * from "./domain/errors.js";
export * from "./domain/backup.js";
export * from "./domain/type-definition.js";
export * from "./domain/worker.js";
export * from "./domain/worker-queue-db.js";
export * from "./domain/execution-log.js";
export * from "./domain/drizzle-db.js";
export * from "./domain/db-client.js";

// Application services
export { PlanningService } from "./application/planning-service.js";
export { VersioningService } from "./application/versioning-service.js";
export { TaskManagementService } from "./application/task-management-service.js";
export {
  TaskSessionService,
  type TaskExecutionMode,
  type StartTaskSessionRequest,
  type CompleteTaskSessionRequest,
  type TaskSession,
} from "./application/task-session-service.js";
export {
  ConflictDetectionService,
  type ConflictWarning,
  type ConflictDetectionResult,
  type FileModification,
} from "./application/conflict-detection-service.js";
export {
  TaskMatchingService,
  type TaskMatchResult,
  type TaskDefinition,
} from "./application/task-matching-service.js";
export {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
  listAllProjects,
  getTrackDirectoryForProject,
  getGlobalDatabasePath,
  resolveGlobalTrackDir,
  getProjectsDirectory,
} from "./application/track-directory-resolver.js";
export {
  TaskSyncService,
  TaskSyncError,
  type TaskActivationResult,
  type ActivationResult,
  type TaskSyncResult,
  type IssueSyncResult,
} from "./application/task-sync-service.js";
export { ProjectService, ProjectError } from "./application/project-service.js";
export { GitOperations } from "./application/git-operations.js";
export { BackupService } from "./application/backup-service.js";
export {
  MergeService,
  MergeValidationError,
  type MergeMode,
  type MergeIssuesRequest,
  type MergeWarning,
  type MergeResult,
} from "./application/merge-service.js";
export {
  IssueStatusService,
  computeIssueStatus,
  type ComputedIssueStatus,
  type TaskCounts,
  type ComputedStatusResult,
} from "./application/issue-status-service.js";
export { DependencyService } from "./application/dependency-service.js";
export {
  TaskService,
  TaskServiceError,
  type AbandonTaskResult,
} from "./application/task-service.js";
export {
  IssueService,
  IssueServiceError,
  type CloseIssueResult,
} from "./application/issue-service.js";
export {
  MilestoneService,
  MilestoneServiceError,
  type MilestoneWithStatus,
} from "./application/milestone-service.js";
export { DispatchService, DispatchServiceError } from "./application/dispatch-service.js";
export { WorkerService, WorkerServiceError } from "./application/worker-service.js";
export { PlanService, PlanServiceError } from "./application/plan-service.js";
export {
  BoardQueryService,
  type BoardIssueWithTasks,
  type WorkerTaskAssignment,
  type WorkerCounts,
  type BoardTask,
  type BoardColumn,
  type BoardData,
} from "./application/board-query-service.js";
export {
  ProjectsResolver,
  type Source,
  type ProjectInfo,
} from "./application/projects-resolver.js";
export {
  resolveConfig,
  loadAllConfigs,
  resolveConfigFromGit,
  writeConfig,
  getConfigPath,
  ProjectConfigError,
  type ProjectConfig,
  type ProjectConfigErrorCode,
} from "./application/projects-resolver.js";

// Infrastructure - Database
export * from "./infrastructure/database/schema.js";
export { sql } from "drizzle-orm";

// PostgreSQL schema (Neon) - exported as a namespace to avoid polluting SQLite schema
export { pgSchema } from "./infrastructure/database/pg-schema-export.js";

// DbSource and DbClient
export type { DbSource } from "./domain/db-source.js";
export { DrizzleDbClient } from "./infrastructure/database/drizzle-db-client.js";
export { DbSourceProvider, type SourceInfo } from "./infrastructure/database/db-source-provider.js";

// Low-level SQLite utilities
export {
  checkpointSqliteDatabase,
  runSqliteMigrations,
} from "./infrastructure/database/sqlite-utils.js";

// Low-level SQLite adapters (internal use)
export { DatabaseFactory } from "./infrastructure/database/database-factory.js";
export type {
  DatabaseAdapter,
  PreparedStatement,
  RunResult,
} from "./infrastructure/database/database-adapter.js";
export { NativeAdapter } from "./infrastructure/database/native-adapter.js";
export { WasmAdapter } from "./infrastructure/database/wasm-adapter.js";

// Infrastructure - Repositories
export { DrizzleIssueRepository } from "./infrastructure/repositories/issue-repository.js";
export { DrizzlePlanRepository } from "./infrastructure/repositories/plan-repository.js";
export { DrizzleTaskRepository } from "./infrastructure/repositories/task-repository.js";
export { DrizzleSnapshotRepository } from "./infrastructure/repositories/snapshot-repository.js";
export { DrizzleMilestoneRepository } from "./infrastructure/repositories/milestone-repository.js";
export { DrizzleProjectRepository } from "./infrastructure/repositories/project-repository.js";
export {
  DrizzleGlobalSettingsRepository,
  SettingKeys,
  type GlobalSettingsRepository,
  type SettingKey,
} from "./infrastructure/repositories/global-settings-repository.js";
export { DrizzleTypeRepository } from "./infrastructure/repositories/type-repository.js";
export { DrizzleExecutionLogRepository } from "./infrastructure/repositories/execution-log-repository.js";

// Infrastructure - Backup
export { S3BackupProvider } from "./infrastructure/backup/s3-backup-provider.js";

// Infrastructure - File System
export type { FileSystem } from "./infrastructure/file-system/file-system.js";
export { NodeFileSystem } from "./infrastructure/file-system/file-system.js";

// Infrastructure - Templates
export { TemplateParser, TemplateParseError } from "./infrastructure/templates/template-parser.js";
export {
  TemplateService,
  TemplateServiceError,
  type TemplateServiceConfig,
  type TemplateScope,
  type TemplateCategory,
} from "./infrastructure/templates/template-service.js";

// Infrastructure - Types
export { TypeService, TypeServiceError } from "./infrastructure/types/type-service.js";

// Infrastructure - GitHub
export {
  NodeGitHubCLI,
  GitHubCLIError,
  type GitHubCLI,
  type GitHubCLIResult,
} from "./infrastructure/github/github-cli.js";

// Infrastructure - Project Management Providers
export {
  GitHubProjectManagementProvider,
  NoOpProjectManagementProvider,
  ProviderRegistry,
  ProviderNotFoundError,
  ProviderDependencyError,
  getProjectManagementProvider,
  GitHubProviderFactory,
  type ProviderFactory,
  type ProviderDependencies,
  type RegisteredProvider,
} from "./infrastructure/providers/index.js";

// Infrastructure - Git Worktrees
export {
  NodeGitWorktreeService,
  GitWorktreeError,
  generateWorktreeNames,
  type GitWorktreeService,
  type WorktreeInfo,
  type GitCommandResult,
} from "./infrastructure/git/git-worktree-service.js";

// Infrastructure - Events
export { EventBus, type DomainEventListener } from "./infrastructure/events/event-bus.js";

// Infrastructure - Worker Queue
export {
  GlobalDbWorkerQueueDb,
  getWorkerQueueDbPath,
} from "./infrastructure/worker-queue/index.js";

// Infrastructure - Port Management
export {
  saveDaemonPort,
  getSavedDaemonPort,
  clearDaemonPort,
  getPortFilePath,
} from "./infrastructure/port-manager.js";

// Infrastructure - Dependency Injection
export {
  // Container building
  ContainerBuilder,
  createTestContainer,
  createContainer,
  asClass,
  asFunction,
  asValue,
  InjectionMode,
  type AwilixContainer,
  type Resolver,
  type Lifetime,
  // Middleware composition
  compose,
  createEndpoint,
  createApiHandler,
  type Middleware,
  // Error mapping
  mapError,
  isDomainError,
  type HttpErrorResponse,
} from "./infrastructure/di/index.js";

// Test utilities - Mock implementations for integration testing
export {
  MockGitHubCLI,
  type MockGitHubCLICall,
  type MockGitHubCLIConfig,
  MockGitWorktreeService,
  type MockGitWorktreeCall,
  type MockGitWorktreeConfig,
  MockFileSystem,
  type MockFileSystemCall,
} from "./__tests__/mocks/index.js";

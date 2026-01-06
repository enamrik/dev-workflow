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
export * from "./domain/milestone.js";
export * from "./domain/project.js";
export * from "./domain/errors.js";
export * from "./domain/backup.js";

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
export { LabelService, type Label } from "./application/label-service.js";
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
} from "./application/track-directory-resolver.js";
export { GitHubSyncService, GitHubSyncError } from "./application/github-sync-service.js";
export {
  TaskGitHubSyncService,
  TaskGitHubSyncError,
  type TaskActivationResult,
  type ActivationResult,
} from "./application/task-github-sync-service.js";
export {
  ProjectService,
  ProjectError,
  NodeGitOperations,
  type GitOperations,
} from "./application/project-service.js";
export { BackupService } from "./application/backup-service.js";

// Infrastructure - Database
export * from "./infrastructure/database/schema.js";
export { DatabaseService } from "./infrastructure/database/database.js";
// Re-export sql from drizzle-orm for raw SQL queries
export { sql } from "drizzle-orm";
export { DatabaseFactory } from "./infrastructure/database/database-factory.js";
export type {
  DatabaseAdapter,
  PreparedStatement,
  RunResult,
} from "./infrastructure/database/database-adapter.js";
export { NativeAdapter } from "./infrastructure/database/native-adapter.js";
export { WasmAdapter } from "./infrastructure/database/wasm-adapter.js";

// Infrastructure - Repositories
export { SqliteIssueRepository } from "./infrastructure/repositories/issue-repository.js";
export { SqlitePlanRepository } from "./infrastructure/repositories/plan-repository.js";
export { SqliteTaskRepository } from "./infrastructure/repositories/task-repository.js";
export { SqliteSnapshotRepository } from "./infrastructure/repositories/snapshot-repository.js";
export { SqliteMilestoneRepository } from "./infrastructure/repositories/milestone-repository.js";
export { SqliteProjectRepository } from "./infrastructure/repositories/project-repository.js";
export {
  SqliteGlobalSettingsRepository,
  SettingKeys,
  type GlobalSettingsRepository,
  type SettingKey,
} from "./infrastructure/repositories/global-settings-repository.js";

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
} from "./infrastructure/templates/template-service.js";

// Infrastructure - GitHub
export {
  NodeGitHubCLI,
  GitHubCLIError,
  type GitHubCLI,
  type GitHubCLIResult,
} from "./infrastructure/github/github-cli.js";

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

// Infrastructure - Port Management
export {
  saveDaemonPort,
  getSavedDaemonPort,
  clearDaemonPort,
  getPortFilePath,
} from "./infrastructure/port-manager.js";

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

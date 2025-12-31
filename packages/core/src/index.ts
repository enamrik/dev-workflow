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

// Application services
export { PlanningService } from "./application/planning-service.js";
export { VersioningService } from "./application/versioning-service.js";
export { TaskManagementService } from "./application/task-management-service.js";
export { TaskSessionService } from "./application/task-session-service.js";
export { SkillService, type Skill } from "./application/skill-service.js";
export {
  TaskMatchingService,
  type TaskMatchResult,
  type TaskDefinition,
} from "./application/task-matching-service.js";

// Infrastructure - Database
export * from "./infrastructure/database/schema.js";
export { DatabaseService } from "./infrastructure/database/database.js";
export { DatabaseFactory } from "./infrastructure/database/database-factory.js";
export type { DatabaseAdapter, PreparedStatement, RunResult } from "./infrastructure/database/database-adapter.js";
export { NativeAdapter } from "./infrastructure/database/native-adapter.js";
export { WasmAdapter } from "./infrastructure/database/wasm-adapter.js";

// Infrastructure - Repositories
export { SqliteIssueRepository } from "./infrastructure/repositories/issue-repository.js";
export { SqlitePlanRepository } from "./infrastructure/repositories/plan-repository.js";
export { SqliteTaskRepository } from "./infrastructure/repositories/task-repository.js";
export { SqliteSnapshotRepository } from "./infrastructure/repositories/snapshot-repository.js";

// Infrastructure - File System
export type { FileSystem } from "./infrastructure/file-system/file-system.js";
export { NodeFileSystem } from "./infrastructure/file-system/file-system.js";

// Infrastructure - Templates
export { TemplateParser, TemplateParseError } from "./infrastructure/templates/template-parser.js";
export { TemplateService, TemplateServiceError } from "./infrastructure/templates/template-service.js";

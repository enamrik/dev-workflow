/**
 * MCP Server Awilix Dependency Injection Container
 *
 * This module provides the Awilix container for the MCP server, registering
 * all services as singletons (server lifetime). Tool contexts are eliminated -
 * services are accessed directly from the cradle.
 */

import * as path from "node:path";
import { createContainer, asFunction, asValue, asClass, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import { createTestContainer } from "@dev-workflow/core/infrastructure/di";
import { DispatchTool } from "../tools/dispatch-tool.js";
import { MilestoneTool } from "../tools/milestone-tool.js";
import { TypeTool } from "../tools/type-tool.js";
import { WorktreeTool } from "../tools/worktree-tool.js";
import { SnapshotTool } from "../tools/snapshot-tool.js";
import { MergeTool } from "../tools/merge-tool.js";
import { SettingsTool } from "../tools/settings-tool.js";
import { PRTool } from "../tools/pr-tool.js";
import { IssueTool } from "../tools/issue-tool.js";
import { TaskTool } from "../tools/task-tool.js";
import { PlanTool } from "../tools/plan-tool.js";
import {
  DbSourceProvider,
  type DbSource,
  type DbClient,
  type Project,
  TemplateService,
  type TemplateServiceConfig,
  TypeService,
  NodeFileSystem,
  VersioningService,
  PlanningService,
  TaskSessionService,
  TaskManagementService,
  TaskSyncService,
  NodeGitHubCLI,
  ProviderRegistry,
  getProjectManagementProvider,
  NodeGitWorktreeService,
  ConflictDetectionService,
  IssueService,
  TaskService,
  MilestoneService,
  PlanService,
  MergeService,
  GlobalDbWorkerQueueDb,
  resolveGlobalTrackDir,
  getGlobalDatabasePath,
  resolveConfig,
  type FileSystem,
  type WorkerQueueDb,
  type ProjectManagementProvider,
  type GitHubCLI,
  type GitWorktreeService,
} from "@dev-workflow/core";

/**
 * Configuration resolved from PROJECT_SLUG
 */
export interface McpConfig {
  readonly projectSlug: string;
  readonly databasePath: string;
  readonly projectId: string;
  readonly gitRoot: string;
}

/**
 * Type definition for the MCP container cradle.
 * All services accessible via container.cradle.
 */
export interface McpCradle {
  // Configuration
  config: McpConfig;
  projectSlug: string;

  // Core infrastructure
  sourceProvider: DbSourceProvider;
  dbSource: DbSource;
  dbClient: DbClient;
  project: Project;
  fileSystem: FileSystem;
  globalTrackDir: string;
  trackDirectory: string;
  projectRoot: string;

  // External integrations
  githubCLI: GitHubCLI;
  providerRegistry: ProviderRegistry;
  projectManagementProvider: ProjectManagementProvider;
  gitWorktreeService: GitWorktreeService;
  workerQueueDb: WorkerQueueDb;

  // Template and type services
  templateConfig: TemplateServiceConfig;
  templateService: TemplateService;
  typeService: TypeService;

  // Application services
  versioningService: VersioningService;
  planningService: PlanningService;
  taskManagementService: TaskManagementService;
  conflictDetectionService: ConflictDetectionService;
  taskSessionService: TaskSessionService;
  taskSyncService: TaskSyncService;

  // Entity services (Service Layer Pattern)
  planService: PlanService;
  taskService: TaskService;
  issueService: IssueService;
  milestoneService: MilestoneService;
  mergeService: MergeService;

  // Tool classes
  dispatchTool: DispatchTool;
  milestoneTool: MilestoneTool;
  typeTool: TypeTool;
  worktreeTool: WorktreeTool;
  snapshotTool: SnapshotTool;
  mergeTool: MergeTool;
  settingsTool: SettingsTool;
  prTool: PRTool;
  issueTool: IssueTool;
  taskTool: TaskTool;
  planTool: PlanTool;
}

/**
 * Module-level DbSourceProvider shared across container lifecycle.
 * Caches DbSource instances by connection string.
 */
const sourceProvider = new DbSourceProvider();

/**
 * Create the MCP Awilix container with all service registrations.
 *
 * All services are registered as singletons since the MCP server has a
 * long-running process with server lifetime scope.
 *
 * @param projectSlug - The project slug from PROJECT_SLUG environment variable
 * @returns Promise resolving to configured Awilix container
 */
export async function createMcpContainer(projectSlug: string): Promise<AwilixContainer<McpCradle>> {
  // Resolve config from ~/.track/projects/{slug}/config.json
  const resolvedConfig = await resolveConfig(projectSlug);
  const gitRoot = resolvedConfig.gitRoot;
  const databasePath = getGlobalDatabasePath();

  // Get or create DbSource (cached by module-level provider)
  const connectionString = `sqlite://${databasePath}`;
  const dbSource = sourceProvider.getOrCreate({ connectionString });

  // Look up project by slug
  const project = await dbSource.projects.findBySlug(projectSlug);

  if (!project) {
    throw new Error(
      `Project not found for slug: ${projectSlug}. ` +
        `Run 'dev-workflow init' to register the project.`
    );
  }

  const config: McpConfig = {
    projectSlug,
    databasePath,
    projectId: project.id,
    gitRoot,
  };

  // Create container with classic injection mode (constructor parameter names)
  const container = createContainer<McpCradle>({
    injectionMode: InjectionMode.CLASSIC,
  });

  // Register values and factories
  container.register({
    // Configuration values
    config: asValue(config),
    projectSlug: asValue(projectSlug),

    // Core infrastructure (singletons)
    sourceProvider: asValue(sourceProvider),
    dbSource: asValue(dbSource),
    project: asValue(project),

    // DbClient scoped to this project
    dbClient: asFunction(() => dbSource.createClient(project.id)).singleton(),

    // File system
    fileSystem: asFunction(() => new NodeFileSystem()).singleton(),

    // Paths
    globalTrackDir: asValue(resolveGlobalTrackDir()),
    projectRoot: asValue(config.gitRoot),
    trackDirectory: asFunction(({ globalTrackDir }) =>
      path.join(globalTrackDir, "projects", project.slug)
    ).singleton(),

    // Template config
    templateConfig: asFunction(({ projectRoot, globalTrackDir }) => ({
      localIssueTemplatesPath: path.join(projectRoot, ".track", "templates", "issues"),
      localTaskTemplatesPath: path.join(projectRoot, ".track", "templates", "tasks"),
      globalIssueTemplatesPath: path.join(globalTrackDir, "config", "templates", "issues"),
      globalTaskTemplatesPath: path.join(globalTrackDir, "config", "templates", "tasks"),
    })).singleton(),

    // External integrations
    githubCLI: asFunction(() => new NodeGitHubCLI()).singleton(),
    providerRegistry: asFunction(() => ProviderRegistry.getInstance()).singleton(),

    projectManagementProvider: asFunction(({ project, githubCLI }) => {
      const providerDeps = { githubCLI };
      return getProjectManagementProvider(project, providerDeps);
    }).singleton(),

    gitWorktreeService: asFunction(
      ({ projectRoot }) => new NodeGitWorktreeService(projectRoot)
    ).singleton(),

    workerQueueDb: asFunction(() => new GlobalDbWorkerQueueDb()).singleton(),

    // Type and template services
    typeService: asFunction(({ dbSource }) => new TypeService(dbSource.types)).singleton(),

    templateService: asFunction(
      ({ fileSystem, templateConfig, typeService }) =>
        new TemplateService(fileSystem, templateConfig, typeService)
    ).singleton(),

    // Application services
    versioningService: asFunction(({ dbClient }) => new VersioningService(dbClient)).singleton(),

    planningService: asFunction(
      ({ dbClient, versioningService }) => new PlanningService(dbClient, versioningService)
    ).singleton(),

    taskManagementService: asFunction(
      ({ dbClient }) => new TaskManagementService(dbClient)
    ).singleton(),

    conflictDetectionService: asFunction(
      ({ dbClient }) => new ConflictDetectionService(dbClient)
    ).singleton(),

    taskSessionService: asFunction(
      ({ dbClient, gitWorktreeService, conflictDetectionService, trackDirectory }) =>
        new TaskSessionService(
          dbClient,
          gitWorktreeService,
          conflictDetectionService,
          trackDirectory
        )
    ).singleton(),

    taskSyncService: asFunction(
      ({ dbSource, projectManagementProvider, config, templateService, typeService }) =>
        new TaskSyncService(
          dbSource,
          projectManagementProvider,
          config.projectId,
          templateService,
          typeService
        )
    ).singleton(),

    // Entity services (Service Layer Pattern)
    planService: asFunction(({ dbClient }) => new PlanService(dbClient)).singleton(),

    taskService: asFunction(
      ({ dbClient, projectManagementProvider, gitWorktreeService }) =>
        new TaskService(dbClient, projectManagementProvider, gitWorktreeService)
    ).singleton(),

    issueService: asFunction(
      ({ dbClient, taskService, projectManagementProvider }) =>
        new IssueService(dbClient, taskService, projectManagementProvider)
    ).singleton(),

    milestoneService: asFunction(({ dbClient }) => new MilestoneService(dbClient)).singleton(),

    mergeService: asFunction(
      ({ dbSource, versioningService, config, githubCLI }) =>
        new MergeService(dbSource, versioningService, config.projectId, githubCLI)
    ).singleton(),

    // Tool classes
    dispatchTool: asClass(DispatchTool).singleton(),
    milestoneTool: asClass(MilestoneTool).singleton(),
    typeTool: asClass(TypeTool).singleton(),
    worktreeTool: asClass(WorktreeTool).singleton(),
    snapshotTool: asClass(SnapshotTool).singleton(),
    mergeTool: asClass(MergeTool).singleton(),
    settingsTool: asClass(SettingsTool).singleton(),
    prTool: asClass(PRTool).singleton(),
    issueTool: asClass(IssueTool).singleton(),
    taskTool: asClass(TaskTool).singleton(),
    planTool: asClass(PlanTool).singleton(),
  });

  return container;
}

/**
 * Type alias for convenience
 */
export type McpContainer = AwilixContainer<McpCradle>;

/**
 * Create a scoped container for testing with mock overrides.
 *
 * Uses the shared createTestContainer utility from core.
 * Creates a child scope that inherits all registrations but allows
 * overriding specific services with mocks.
 *
 * @example
 * ```typescript
 * const testScope = createTestScope(container, {
 *   issueService: () => mockIssueService,
 *   taskService: () => mockTaskService,
 * });
 * const result = await handler(args, testScope.cradle);
 * ```
 */
export function createTestScope(
  container: McpContainer,
  overrides: Partial<{ [K in keyof McpCradle]: () => McpCradle[K] }> = {}
): McpContainer {
  return createTestContainer(container, overrides);
}

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
  NodeGitHubCLI,
  ProjectManagementRegistry,
  getProjectManagementService,
  getProjectManagementProvider,
  type ProjectManagementProvider,
  ConflictDetectionService,
  IssueService,
  TaskService,
  MilestoneService,
  PlanService,
  MergeService,
  ProjectManagementService,
  type FileSystem,
  type GitHubCLI,
} from "@dev-workflow/tracking";
import {
  NodeGitWorktreeService,
  type GitWorktreeService,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { getGlobalDatabasePath } from "@dev-workflow/git/track-directory-resolver.js";
import { resolveConfig } from "@dev-workflow/tracking";

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
  providerRegistry: ProjectManagementRegistry;
  projectManagementService: ProjectManagementService;
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

  // Create container with PROXY injection mode.
  // PROXY mode supports destructured parameters in asFunction callbacks,
  // while CLASSIC mode requires named parameters matching registration keys.
  const container = createContainer<McpCradle>({
    injectionMode: InjectionMode.PROXY,
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
    trackDirectory: asFunction(({ globalTrackDir }: { globalTrackDir: string }) =>
      path.join(globalTrackDir, "projects", project.slug)
    ).singleton(),

    // Template config
    templateConfig: asFunction(
      ({ projectRoot, globalTrackDir }: { projectRoot: string; globalTrackDir: string }) => ({
        localIssueTemplatesPath: path.join(projectRoot, ".track", "templates", "issues"),
        localTaskTemplatesPath: path.join(projectRoot, ".track", "templates", "tasks"),
        globalIssueTemplatesPath: path.join(globalTrackDir, "config", "templates", "issues"),
        globalTaskTemplatesPath: path.join(globalTrackDir, "config", "templates", "tasks"),
      })
    ).singleton(),

    // External integrations
    githubCLI: asFunction(() => new NodeGitHubCLI()).singleton(),
    providerRegistry: asFunction(() => ProjectManagementRegistry.getInstance()).singleton(),

    projectManagementService: asFunction(
      ({ project: proj, githubCLI: cli }: { project: Project; githubCLI: GitHubCLI }) => {
        const providerDeps = { githubCLI: cli };
        return getProjectManagementService(proj, providerDeps);
      }
    ).singleton(),

    projectManagementProvider: asFunction(
      ({ project: proj, githubCLI: cli }: { project: Project; githubCLI: GitHubCLI }) => {
        const providerDeps = { githubCLI: cli };
        return getProjectManagementProvider(proj, providerDeps);
      }
    ).singleton(),

    gitWorktreeService: asFunction(
      ({ projectRoot }: { projectRoot: string }) => new NodeGitWorktreeService(projectRoot)
    ).singleton(),

    workerQueueDb: asFunction(() => new GlobalDbWorkerQueueDb()).singleton(),

    // Type and template services
    typeService: asFunction(
      ({ dbSource: src }: { dbSource: DbSource }) => new TypeService(src.types)
    ).singleton(),

    templateService: asFunction(
      ({
        fileSystem,
        templateConfig,
        typeService,
      }: {
        fileSystem: FileSystem;
        templateConfig: TemplateServiceConfig;
        typeService: TypeService;
      }) => new TemplateService(fileSystem, templateConfig, typeService)
    ).singleton(),

    // Application services
    versioningService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new VersioningService(dbClient)
    ).singleton(),

    planningService: asFunction(
      ({
        dbClient,
        versioningService,
      }: {
        dbClient: DbClient;
        versioningService: VersioningService;
      }) => new PlanningService(dbClient, versioningService)
    ).singleton(),

    taskManagementService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new TaskManagementService(dbClient)
    ).singleton(),

    conflictDetectionService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new ConflictDetectionService(dbClient)
    ).singleton(),

    taskSessionService: asFunction(
      ({
        dbClient,
        gitWorktreeService,
        conflictDetectionService,
        trackDirectory,
      }: {
        dbClient: DbClient;
        gitWorktreeService: GitWorktreeService;
        conflictDetectionService: ConflictDetectionService;
        trackDirectory: string;
      }) =>
        new TaskSessionService(
          dbClient,
          gitWorktreeService,
          conflictDetectionService,
          trackDirectory
        )
    ).singleton(),

    // Entity services (Service Layer Pattern)
    planService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new PlanService(dbClient)
    ).singleton(),

    taskService: asFunction(
      ({
        dbClient,
        projectManagementService,
        gitWorktreeService,
        workerQueueDb,
        templateService,
        typeService,
      }: {
        dbClient: DbClient;
        projectManagementService: ProjectManagementService;
        gitWorktreeService: GitWorktreeService;
        workerQueueDb: WorkerQueueDb;
        templateService: TemplateService;
        typeService: TypeService;
      }) =>
        new TaskService(
          dbClient,
          projectManagementService,
          gitWorktreeService,
          workerQueueDb,
          templateService,
          typeService
        )
    ).singleton(),

    issueService: asFunction(
      ({
        dbClient,
        taskService,
        projectManagementService,
      }: {
        dbClient: DbClient;
        taskService: TaskService;
        projectManagementService: ProjectManagementService;
      }) => new IssueService(dbClient, taskService, projectManagementService)
    ).singleton(),

    milestoneService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new MilestoneService(dbClient)
    ).singleton(),

    mergeService: asFunction(
      ({
        dbSource: src,
        versioningService,
        config: cfg,
        githubCLI: cli,
      }: {
        dbSource: DbSource;
        versioningService: VersioningService;
        config: McpConfig;
        githubCLI: GitHubCLI;
      }) => new MergeService(src, versioningService, cfg.projectId, cli)
    ).singleton(),

    // Tool classes
    dispatchTool: asClass(DispatchTool).singleton(),
    milestoneTool: asClass(MilestoneTool).singleton(),
    typeTool: asClass(TypeTool).singleton(),
    worktreeTool: asClass(WorktreeTool).singleton(),
    snapshotTool: asClass(SnapshotTool).singleton(),
    mergeTool: asClass(MergeTool).singleton(),
    settingsTool: asClass(SettingsTool).singleton(),
    prTool: asFunction(
      ({
        githubCLI,
        issueService,
        planService,
        taskService,
        gitWorktreeService,
        dbClient,
      }: {
        githubCLI: GitHubCLI;
        issueService: IssueService;
        planService: PlanService;
        taskService: TaskService;
        gitWorktreeService: GitWorktreeService | null;
        dbClient: DbClient;
      }) =>
        new PRTool(githubCLI, issueService, planService, taskService, gitWorktreeService, dbClient)
    ).singleton(),
    issueTool: asFunction(
      ({
        project,
        issueService,
        planService,
        taskService,
        milestoneService,
        workerQueueDb,
        templateService,
        planningService,
        projectManagementProvider,
        gitWorktreeService,
        githubCLI,
        typeService,
      }: {
        project: Project;
        issueService: IssueService;
        planService: PlanService;
        taskService: TaskService;
        milestoneService: MilestoneService;
        workerQueueDb: WorkerQueueDb;
        templateService: TemplateService;
        planningService: PlanningService;
        projectManagementProvider: ProjectManagementProvider;
        gitWorktreeService: GitWorktreeService;
        githubCLI: GitHubCLI;
        typeService: TypeService;
      }) =>
        new IssueTool(
          project,
          issueService,
          planService,
          taskService,
          milestoneService,
          workerQueueDb,
          templateService,
          planningService,
          projectManagementProvider,
          gitWorktreeService,
          githubCLI,
          typeService
        )
    ).singleton(),
    taskTool: asFunction(
      ({
        taskService,
        taskSessionService,
        taskManagementService,
        planService,
        issueService,
        dbClient,
        workerQueueDb,
        conflictDetectionService,
        providerRegistry,
        project,
        dbSource,
        githubCLI,
      }: {
        taskService: TaskService;
        taskSessionService: TaskSessionService;
        taskManagementService: TaskManagementService;
        planService: PlanService;
        issueService: IssueService;
        dbClient: DbClient;
        workerQueueDb: WorkerQueueDb;
        conflictDetectionService: ConflictDetectionService;
        providerRegistry: ProjectManagementRegistry;
        project: Project;
        dbSource: DbSource;
        githubCLI: GitHubCLI;
      }) =>
        new TaskTool(
          taskService,
          taskSessionService,
          taskManagementService,
          planService,
          issueService,
          dbClient,
          workerQueueDb,
          conflictDetectionService,
          providerRegistry,
          project,
          dbSource,
          githubCLI
        )
    ).singleton(),
    planTool: asFunction(
      ({
        project,
        issueService,
        planService,
        taskService,
        planningService,
        typeService,
      }: {
        project: Project;
        issueService: IssueService;
        planService: PlanService;
        taskService: TaskService;
        planningService: PlanningService;
        typeService: TypeService;
      }) =>
        new PlanTool(project, issueService, planService, taskService, planningService, typeService)
    ).singleton(),
  });

  return container;
}

/**
 * Type alias for convenience
 */
export type McpContainer = AwilixContainer<McpCradle>;

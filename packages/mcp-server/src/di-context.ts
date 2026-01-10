/**
 * MCP Server Dependency Injection Context
 *
 * This class encapsulates all dependency wiring for the MCP server.
 * It creates repositories, services, and tool contexts via constructor injection,
 * following the DI pattern established in CLAUDE.md.
 */

import * as path from "node:path";
import {
  DataSourceFactory,
  type SqliteDataSource,
  SqliteIssueRepository,
  SqliteSnapshotRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteMilestoneRepository,
  SqliteProjectRepository,
  SqliteDispatchQueueRepository,
  SqliteWorkerRepository,
  TemplateService,
  type TemplateServiceConfig,
  TypeService,
  NodeFileSystem,
  VersioningService,
  PlanningService,
  TaskSessionService,
  TaskManagementService,
  taskExecutionLogs,
  GitHubSyncService,
  TaskGitHubSyncService,
  NodeGitHubCLI,
  ProviderRegistry,
  getProjectManagementProvider,
  NodeGitWorktreeService,
  ConflictDetectionService,
  type Project,
  resolveGlobalTrackDir,
  resolveConfig,
} from "@dev-workflow/core";

import type {
  IssueToolContext,
  PlanToolContext,
  TaskToolContext,
  SnapshotToolContext,
  SettingsToolContext,
  MilestoneToolContext,
  WorktreeToolContext,
  PRToolContext,
  MergeToolContext,
  TypeToolContext,
  DispatchToolContext,
} from "./tools/index.js";

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
 * McpDIContext - Dependency injection container for MCP server
 *
 * Creates and wires all repositories, services, and tool contexts.
 * Each tool context is exposed as a readonly property for use in request handlers.
 *
 * Usage:
 * ```typescript
 * const context = await McpDIContext.create(projectSlug);
 * // Access tool contexts
 * handleCreateIssue(context.issueToolContext, args);
 * ```
 */
export class McpDIContext {
  // Core infrastructure
  readonly dataSource: SqliteDataSource;
  readonly project: Project;
  readonly config: McpConfig;

  // Tool contexts for each tool family
  readonly issueToolContext: IssueToolContext;
  readonly planToolContext: PlanToolContext;
  readonly taskToolContext: TaskToolContext;
  readonly snapshotToolContext: SnapshotToolContext;
  readonly settingsToolContext: SettingsToolContext;
  readonly milestoneToolContext: MilestoneToolContext;
  readonly worktreeToolContext: WorktreeToolContext;
  readonly prToolContext: PRToolContext;
  readonly mergeToolContext: MergeToolContext;
  readonly typeToolContext: TypeToolContext;
  readonly dispatchToolContext: DispatchToolContext;

  private constructor(
    dataSource: SqliteDataSource,
    project: Project,
    config: McpConfig,
    issueToolContext: IssueToolContext,
    planToolContext: PlanToolContext,
    taskToolContext: TaskToolContext,
    snapshotToolContext: SnapshotToolContext,
    settingsToolContext: SettingsToolContext,
    milestoneToolContext: MilestoneToolContext,
    worktreeToolContext: WorktreeToolContext,
    prToolContext: PRToolContext,
    mergeToolContext: MergeToolContext,
    typeToolContext: TypeToolContext,
    dispatchToolContext: DispatchToolContext
  ) {
    this.dataSource = dataSource;
    this.project = project;
    this.config = config;
    this.issueToolContext = issueToolContext;
    this.planToolContext = planToolContext;
    this.taskToolContext = taskToolContext;
    this.snapshotToolContext = snapshotToolContext;
    this.settingsToolContext = settingsToolContext;
    this.milestoneToolContext = milestoneToolContext;
    this.worktreeToolContext = worktreeToolContext;
    this.prToolContext = prToolContext;
    this.mergeToolContext = mergeToolContext;
    this.typeToolContext = typeToolContext;
    this.dispatchToolContext = dispatchToolContext;
  }

  /**
   * Create a new McpDIContext from a project slug.
   *
   * This is an async factory method because it needs to:
   * 1. Resolve config from slug
   * 2. Create database connection
   * 3. Load project from database
   *
   * @param projectSlug - The project slug (e.g., "dev-workflow-b9bccf")
   * @throws Error if config resolution fails or project not found
   */
  static async create(projectSlug: string): Promise<McpDIContext> {
    // Resolve config from slug
    const resolvedConfig = await resolveConfig(projectSlug);
    const config: McpConfig = {
      projectSlug,
      databasePath: resolvedConfig.resolvedDatabase,
      projectId: resolvedConfig.projectId,
      gitRoot: resolvedConfig.gitRoot,
    };

    // Initialize database
    const dataSource = await DataSourceFactory.createSqlite(config.databasePath);
    const db = dataSource.getDb();

    // Load project from database
    const projectRepository = new SqliteProjectRepository(db);
    const project = await projectRepository.findById(config.projectId);

    if (!project) {
      throw new Error(
        `Project not found in database: ${config.projectId}. ` +
          `Run 'dev-workflow update' to migrate to the new project system.`
      );
    }

    // Initialize repositories with project scoping
    const issueRepository = new SqliteIssueRepository(db, config.projectId);
    const snapshotRepository = new SqliteSnapshotRepository(db, config.projectId);
    const planRepository = new SqlitePlanRepository(db);
    const taskRepository = new SqliteTaskRepository(db);
    const milestoneRepository = new SqliteMilestoneRepository(db, config.projectId);
    const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

    // Initialize file system and paths
    const fileSystem = new NodeFileSystem();
    const projectRoot = config.gitRoot;
    const globalTrackDir = resolveGlobalTrackDir();

    // Track directory for project-specific data (worktrees, etc.) in global location
    const trackDirectory = path.join(globalTrackDir, project.slug);

    // Template paths follow cascading resolution
    const templateConfig: TemplateServiceConfig = {
      localIssueTemplatesPath: path.join(projectRoot, ".track", "templates", "issues"),
      localTaskTemplatesPath: path.join(projectRoot, ".track", "templates", "tasks"),
      globalIssueTemplatesPath: path.join(globalTrackDir, "config", "templates", "issues"),
      globalTaskTemplatesPath: path.join(globalTrackDir, "config", "templates", "tasks"),
    };

    // Initialize type repository and service (types are stored in global DB)
    const typeRepository = dataSource.getTypeRepository();
    const typeService = new TypeService(typeRepository);
    const templateService = new TemplateService(fileSystem, templateConfig, typeService);

    // Initialize project management provider
    const githubCLI = new NodeGitHubCLI();
    const providerRegistry = ProviderRegistry.getInstance();
    const providerDeps = { githubCLI };
    const projectManagementProvider = getProjectManagementProvider(project, providerDeps);

    // GitHub sync services
    const githubSyncService = new GitHubSyncService(
      issueRepository,
      projectManagementProvider,
      projectRepository,
      config.projectId
    );

    const taskGitHubSyncService = new TaskGitHubSyncService(
      taskRepository,
      issueRepository,
      planRepository,
      projectManagementProvider,
      projectRepository,
      config.projectId,
      templateService,
      typeService
    );

    // Application services
    const versioningService = new VersioningService(
      issueRepository,
      snapshotRepository,
      planRepository,
      taskRepository
    );

    const planningService = new PlanningService(
      issueRepository,
      planRepository,
      taskRepository,
      versioningService
    );

    const taskManagementService = new TaskManagementService(
      taskRepository,
      planRepository,
      issueRepository
    );

    const gitWorktreeService = new NodeGitWorktreeService(projectRoot);
    const conflictDetectionService = new ConflictDetectionService(db, taskRepository);

    const taskSessionService = new TaskSessionService(
      taskRepository,
      planRepository,
      issueRepository,
      gitWorktreeService,
      conflictDetectionService,
      trackDirectory
    );

    // Create tool contexts
    const issueToolContext: IssueToolContext = {
      project,
      issueRepository,
      planRepository,
      taskRepository,
      milestoneRepository,
      dispatchQueueRepository,
      templateService,
      planningService,
      githubSyncService,
      githubCLI,
      gitWorktreeService,
      typeService,
    };

    const planToolContext: PlanToolContext = {
      project,
      issueRepository,
      planRepository,
      taskRepository,
      planningService,
      taskGitHubSyncService,
      typeService,
    };

    const taskToolContext: TaskToolContext = {
      dbService: dataSource,
      issueRepository,
      planRepository,
      taskRepository,
      taskSessionService,
      taskManagementService,
      taskExecutionLogsSchema: taskExecutionLogs,
      conflictDetectionService,
      taskGitHubSyncService,
      providerRegistry,
      project,
      projectRepository,
      githubCLI,
      dispatchQueueRepository,
    };

    const snapshotToolContext: SnapshotToolContext = {
      issueRepository,
      versioningService,
    };

    const settingsToolContext: SettingsToolContext = {
      project,
      projectRepository,
      githubCLI,
      gitRoot: config.gitRoot,
      providerRegistry,
      typeService,
    };

    const milestoneToolContext: MilestoneToolContext = {
      milestoneRepository,
      issueRepository,
      projectName: project.name,
    };

    const worktreeToolContext: WorktreeToolContext = {
      projectRoot,
    };

    const prToolContext: PRToolContext = {
      githubCLI: new NodeGitHubCLI(),
      issueRepository,
      planRepository,
      taskRepository,
      gitWorktreeService,
      taskGitHubSyncService,
      dbService: dataSource,
      taskExecutionLogsSchema: taskExecutionLogs,
    };

    const mergeToolContext: MergeToolContext = {
      issueRepository,
      planRepository,
      taskRepository,
      projectRepository,
      versioningService,
      projectId: config.projectId,
      githubCLI,
    };

    const typeToolContext: TypeToolContext = {
      typeService,
    };

    const workerRepository = new SqliteWorkerRepository(db);

    const dispatchToolContext: DispatchToolContext = {
      dispatchQueueRepository,
      taskRepository,
      workerRepository,
    };

    return new McpDIContext(
      dataSource,
      project,
      config,
      issueToolContext,
      planToolContext,
      taskToolContext,
      snapshotToolContext,
      settingsToolContext,
      milestoneToolContext,
      worktreeToolContext,
      prToolContext,
      mergeToolContext,
      typeToolContext,
      dispatchToolContext
    );
  }

  /**
   * Close the database connection.
   * Call this during server shutdown.
   */
  close(): void {
    this.dataSource.close();
  }

  /**
   * Log provider status for startup diagnostics.
   */
  logProviderStatus(): void {
    const providerRegistry = ProviderRegistry.getInstance();
    const githubCLI = new NodeGitHubCLI();
    const providerDeps = { githubCLI };

    if (this.project.githubSync?.enabled) {
      const projectManagementProvider = getProjectManagementProvider(this.project, providerDeps);
      const providerId = projectManagementProvider.providerId;
      const providerInfo = providerRegistry.tryGet(providerId);
      const displayName = providerInfo?.displayName ?? providerId;
      console.error(`External sync enabled: ${displayName} provider (repository auto-detected)`);
    } else {
      const availableProviders = providerRegistry.list(providerDeps);
      const providerNames = availableProviders
        .filter((p) => p.available)
        .map((p) => p.displayName)
        .join(", ");
      console.error(`External sync not configured (available providers: ${providerNames})`);
    }
  }
}

/**
 * MCP Server Dependency Injection Context
 *
 * This class encapsulates all dependency wiring for the MCP server.
 * It creates repositories, services, and tool contexts via constructor injection,
 * following the DI pattern established in CLAUDE.md.
 */

import * as path from "node:path";
import {
  DbSourceProvider,
  type DbSource,
  type DbClient,
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
  type Project,
  resolveGlobalTrackDir,
  getGlobalDatabasePath,
  resolveConfig,
  // New services for Service Layer Pattern
  IssueService,
  TaskService,
  MilestoneService,
  WorkerService,
  DispatchService,
  PlanService,
  MergeService,
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

// =============================================================================
// Module-level DbSourceProvider
// =============================================================================

/**
 * Shared DbSourceProvider for the MCP server process.
 * Caches DbSource instances by connection string across tool calls.
 */
const sourceProvider = new DbSourceProvider();

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
  readonly dbSource: DbSource;
  readonly dbClient: DbClient;
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
    dbSource: DbSource,
    dbClient: DbClient,
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
    this.dbSource = dbSource;
    this.dbClient = dbClient;
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
   * 1. Read config from ~/.track/projects/{slug}/config.json
   * 2. Create database connection
   * 3. Load project from database by slug
   *
   * @param projectSlug - The project slug (e.g., "dev-workflow-b9bccf")
   * @throws Error if config not found or project not found
   */
  static async create(projectSlug: string): Promise<McpDIContext> {
    // Resolve config from ~/.track/projects/{slug}/config.json
    // This contains gitRoot, database path, and other project settings
    const resolvedConfig = await resolveConfig(projectSlug);
    const gitRoot = resolvedConfig.gitRoot;

    // Database is global at ~/.track/workflow.db
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

    // Create DbClient scoped to this project
    const dbClient = dbSource.createClient(project.id);

    // Initialize file system and paths
    const fileSystem = new NodeFileSystem();
    const projectRoot = config.gitRoot;
    const globalTrackDir = resolveGlobalTrackDir();

    // Track directory for project-specific data (worktrees, etc.) in global location
    // Must include "projects" subdirectory to match migration in TrackDirectoryResolver
    const trackDirectory = path.join(globalTrackDir, "projects", project.slug);

    // Template paths follow cascading resolution
    const templateConfig: TemplateServiceConfig = {
      localIssueTemplatesPath: path.join(projectRoot, ".track", "templates", "issues"),
      localTaskTemplatesPath: path.join(projectRoot, ".track", "templates", "tasks"),
      globalIssueTemplatesPath: path.join(globalTrackDir, "config", "templates", "issues"),
      globalTaskTemplatesPath: path.join(globalTrackDir, "config", "templates", "tasks"),
    };

    // Initialize type and template services
    const typeService = new TypeService(dbSource.types);
    const templateService = new TemplateService(fileSystem, templateConfig, typeService);

    // Initialize project management provider
    const githubCLI = new NodeGitHubCLI();
    const providerRegistry = ProviderRegistry.getInstance();
    const providerDeps = { githubCLI };
    const projectManagementProvider = getProjectManagementProvider(project, providerDeps);

    // Task sync service
    const taskSyncService = new TaskSyncService(
      dbSource,
      projectManagementProvider,
      config.projectId,
      templateService,
      typeService
    );

    // Application services
    const versioningService = new VersioningService(dbClient);

    const planningService = new PlanningService(dbClient, versioningService);

    const taskManagementService = new TaskManagementService(dbClient);

    const gitWorktreeService = new NodeGitWorktreeService(projectRoot);

    const conflictDetectionService = new ConflictDetectionService(dbClient);

    const taskSessionService = new TaskSessionService(
      dbClient,
      gitWorktreeService,
      conflictDetectionService,
      trackDirectory
    );

    // Entity services (Service Layer Pattern)
    const planService = new PlanService(dbClient);
    // Worker and Dispatch services use DbSource (global repos), not DbClient
    const workerService = new WorkerService(dbSource);
    const dispatchService = new DispatchService(dbSource);

    const taskService = new TaskService(dbClient, projectManagementProvider, gitWorktreeService);

    const issueService = new IssueService(dbClient, taskService, projectManagementProvider);

    const milestoneService = new MilestoneService(dbClient);

    const mergeServiceInstance = new MergeService(
      dbSource,
      versioningService,
      config.projectId,
      githubCLI
    );

    // Create tool contexts (using services, not repositories)
    const issueToolContext: IssueToolContext = {
      project,
      issueService,
      planService,
      taskService,
      milestoneService,
      dispatchService,
      templateService,
      planningService,
      projectManagementProvider,
      githubCLI,
      gitWorktreeService,
      typeService,
    };

    const planToolContext: PlanToolContext = {
      project,
      issueService,
      planService,
      taskService,
      planningService,
      taskSyncService,
      typeService,
    };

    const taskToolContext: TaskToolContext = {
      db: dbClient,
      issueService,
      planService,
      taskService,
      dispatchService,
      taskSessionService,
      taskManagementService,
      conflictDetectionService,
      taskSyncService,
      providerRegistry,
      project,
      source: dbSource,
      githubCLI,
    };

    const snapshotToolContext: SnapshotToolContext = {
      issueService,
      versioningService,
    };

    const settingsToolContext: SettingsToolContext = {
      project,
      source: dbSource,
      githubCLI,
      gitRoot: config.gitRoot,
      providerRegistry,
      typeService,
    };

    const milestoneToolContext: MilestoneToolContext = {
      milestoneService,
      issueService,
      projectName: project.name,
    };

    const worktreeToolContext: WorktreeToolContext = {
      projectRoot,
    };

    const prToolContext: PRToolContext = {
      project,
      githubCLI,
      issueService,
      planService,
      taskService,
      gitWorktreeService,
      taskSyncService,
      db: dbClient,
    };

    const mergeToolContext: MergeToolContext = {
      mergeService: mergeServiceInstance,
    };

    const typeToolContext: TypeToolContext = {
      typeService,
    };

    const dispatchToolContext: DispatchToolContext = {
      dispatchService,
      taskService,
      workerService,
    };

    return new McpDIContext(
      dbSource,
      dbClient,
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
    this.dbSource.close();
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

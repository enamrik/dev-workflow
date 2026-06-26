/**
 * MCP Server Awilix Dependency Injection Container
 *
 * This module provides the Awilix container for the MCP server, registering
 * all services as singletons (server lifetime). Tool contexts are eliminated -
 * services are accessed directly from the cradle.
 */

import * as path from "node:path";
import { Effect } from "@dev-workflow/effect";
import { createContainer, asFunction, asValue, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import {
  DbSourceProvider,
  DomainExecutorFactory,
  type DbSource,
  type DbClient,
  type Project,
  TemplateService,
  type TemplateServiceConfig,
  TypeDomainService,
  NodeFileSystem,
  VersioningService,
  TaskDomainService,
  ConflictDetectionService,
  MilestoneDomainService,
  PlanDomainService,
  IssueDomainService,
  MergeService,
  EventBus,
  type FileSystem,
} from "@dev-workflow/tracking";
import {
  NodeGitWorktreeService,
  type GitWorktreeService,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { NodeGitHubCLI, type GitHubCLI } from "@dev-workflow/git/github/github-cli.js";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { getGlobalDatabasePath } from "@dev-workflow/git/track-directory-resolver.js";
import { resolveConfig } from "@dev-workflow/tracking";

/**
 * Configuration resolved from DFL_PROJECT_SLUG
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
  domain: DomainExecutorFactory;
  dbSource: DbSource;
  dbClient: DbClient;
  project: Project;
  fileSystem: FileSystem;
  globalTrackDir: string;
  trackDirectory: string;
  projectRoot: string;

  // External integrations
  gitWorktreeService: GitWorktreeService;
  githubCLI: GitHubCLI;
  workerQueueDb: WorkerQueueDb;

  // Template and type services
  templateConfig: TemplateServiceConfig;
  templateService: TemplateService;
  typeDomainService: TypeDomainService;

  // Application services
  versioningService: VersioningService;
  conflictDetectionService: ConflictDetectionService;

  // Domain services
  taskDomainService: TaskDomainService;
  planDomainService: PlanDomainService;
  issueDomainService: IssueDomainService;
  milestoneDomainService: MilestoneDomainService;

  // Entity services (Service Layer Pattern)
  mergeService: MergeService;

  // Events
  eventBus: EventBus;
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
 * @param projectSlug - The project slug from DFL_PROJECT_SLUG environment variable
 * @returns Promise resolving to configured Awilix container
 */
export async function createMcpContainer(projectSlug: string): Promise<AwilixContainer<McpCradle>> {
  // Resolve config from ~/.dfl/track/projects/{slug}/config.json
  const resolvedConfig = await resolveConfig(projectSlug);
  const gitRoot = resolvedConfig.gitRoot;
  const databasePath = getGlobalDatabasePath();

  // Get or create DbSource (cached by module-level provider)
  const connectionString = `sqlite://${databasePath}`;
  const dbSource = sourceProvider.getOrCreate({ connectionString });

  // Look up project by slug
  const project = await Effect.runPromise(dbSource.projects.findBySlug(projectSlug));

  if (!project) {
    throw new Error(
      `Project not found for slug: ${projectSlug}. ` + `Run 'dfl init' to register the project.`
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
    domain: asFunction(
      ({
        sourceProvider: sp,
        typeDomainService: tds,
      }: {
        sourceProvider: DbSourceProvider;
        typeDomainService: TypeDomainService;
      }) => new DomainExecutorFactory(sp, tds)
    ).singleton(),
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
    gitWorktreeService: asFunction(
      ({ projectRoot }: { projectRoot: string }) => new NodeGitWorktreeService(projectRoot)
    ).singleton(),

    githubCLI: asFunction(
      ({ projectRoot }: { projectRoot: string }) => new NodeGitHubCLI(projectRoot)
    ).singleton(),

    workerQueueDb: asFunction(() => new GlobalDbWorkerQueueDb()).singleton(),

    // Type and template services
    typeDomainService: asFunction(
      ({ dbSource: src }: { dbSource: DbSource }) => new TypeDomainService(src.types)
    ).singleton(),

    templateService: asFunction(
      ({
        fileSystem,
        templateConfig,
        typeDomainService,
      }: {
        fileSystem: FileSystem;
        templateConfig: TemplateServiceConfig;
        typeDomainService: TypeDomainService;
      }) => new TemplateService(fileSystem, templateConfig, typeDomainService)
    ).singleton(),

    // Application services
    versioningService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new VersioningService(dbClient)
    ).singleton(),

    conflictDetectionService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new ConflictDetectionService(dbClient)
    ).singleton(),

    // Domain services
    taskDomainService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) =>
        new TaskDomainService(dbClient.tasks, dbClient.plans, dbClient.issues)
    ).singleton(),

    planDomainService: asFunction(
      ({
        dbClient,
        typeDomainService,
      }: {
        dbClient: DbClient;
        typeDomainService: TypeDomainService;
      }) =>
        new PlanDomainService(dbClient.plans, dbClient.tasks, dbClient.issues, typeDomainService)
    ).singleton(),

    issueDomainService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) => new IssueDomainService(dbClient.issues)
    ).singleton(),

    milestoneDomainService: asFunction(
      ({ dbClient }: { dbClient: DbClient }) =>
        new MilestoneDomainService(dbClient.milestones, dbClient.issues)
    ).singleton(),

    // Events
    eventBus: asValue(new EventBus()),

    // Entity services (Service Layer Pattern)
    mergeService: asFunction(
      ({
        dbSource: src,
        versioningService,
        config: cfg,
      }: {
        dbSource: DbSource;
        versioningService: VersioningService;
        config: McpConfig;
      }) => new MergeService(src, versioningService, cfg.projectId)
    ).singleton(),
  });

  return container;
}

/**
 * Type alias for convenience
 */
export type McpContainer = AwilixContainer<McpCradle>;

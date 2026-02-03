/**
 * WebDIContext - Dependency injection context for web package
 *
 * This class provides service access for a single project, following
 * proper dependency injection patterns:
 * - Constructor injection of projectSlug
 * - Uses ProjectsResolver for config resolution
 * - Uses DbSourceProvider for database connections
 *
 * Usage:
 * ```typescript
 * // In a route handler
 * const context = await WebDIContext.create(projectSlug);
 * const issues = context.db.issues.findMany({});
 * ```
 */

import {
  ProjectsResolver,
  DbSourceProvider,
  type DbClient,
  type DbSource,
  type ProjectInfo,
  IssueStatusService,
  IssueService,
  TaskService,
  PlanDomainService,
  IssueDomainService,
  MilestoneDomainService,
  TypeDomainService,
  BoardQueryService,
  ProjectManagementService,
  NoOpProjectManagementClient,
} from "@dev-workflow/tracking";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// WebDIContext
// =============================================================================

/**
 * Dependency injection context for web routes
 *
 * Provides access to services for a specific project.
 */
export class WebDIContext {
  // ============================================================================
  // Database Access
  // ============================================================================

  /** Database source (global repos: projects, types, globalSettings) */
  readonly source: DbSource;

  /** Database client (project-scoped repos: issues, plans, tasks, etc.) */
  readonly db: DbClient;

  // ============================================================================
  // Services (for mutations and orchestrated operations)
  // ============================================================================

  /** Service for issue operations */
  readonly issueService: IssueService;

  /** Service for task operations */
  readonly taskService: TaskService;

  /** Domain service for plan operations */
  readonly planDomainService: PlanDomainService;

  /** Domain service for issue operations */
  readonly issueDomainService: IssueDomainService;

  /** Domain service for milestone operations */
  readonly milestoneDomainService: MilestoneDomainService;

  /** Service for computing issue status from task states */
  readonly issueStatusService: IssueStatusService;

  /** Service for board queries */
  readonly boardQueryService: BoardQueryService;

  /** Project ID (UUID) */
  readonly projectId: string;

  /** Project slug */
  readonly projectSlug: string;

  /**
   * Create a WebDIContext for a project
   *
   * @param projectSlug - Project slug (e.g., "dev-workflow-b9bccf")
   * @param source - DbSource for global repository access
   * @param db - DbClient for project-scoped access
   */
  private constructor(projectSlug: string, source: DbSource, db: DbClient) {
    this.projectSlug = projectSlug;
    this.projectId = db.projectId;
    this.source = source;
    this.db = db;

    // Create services with injected DbClient
    // Note: Web UI doesn't have GitHub sync or worktree service, so we use NoOp client
    const noOpClient = new NoOpProjectManagementClient();
    const projectManagement = new ProjectManagementService(noOpClient);
    const typeDomainService = new TypeDomainService(source.types);
    this.planDomainService = new PlanDomainService(
      db.plans,
      db.tasks,
      db.issues,
      typeDomainService
    );
    this.issueDomainService = new IssueDomainService(db.issues);
    this.taskService = new TaskService(db, projectManagement, null);
    this.issueService = new IssueService(db, this.taskService, projectManagement);
    this.milestoneDomainService = new MilestoneDomainService(db.milestones, db.issues);

    // Create status service with injected DbClient
    this.issueStatusService = new IssueStatusService(db);

    // Create board query service
    this.boardQueryService = new BoardQueryService(db);
  }

  /**
   * Create a WebDIContext for a project by slug
   *
   * @param projectSlug - Project slug (e.g., "dev-workflow-b9bccf")
   * @param resolver - Optional shared resolver (created if not provided)
   * @param sourceProvider - Optional shared source provider (created if not provided)
   * @returns WebDIContext for the project
   * @throws Error if project not found
   */
  static async create(
    projectSlug: string,
    resolver?: ProjectsResolver,
    sourceProvider?: DbSourceProvider
  ): Promise<WebDIContext> {
    const res = resolver ?? new ProjectsResolver();
    const provider = sourceProvider ?? new DbSourceProvider();

    // Get project config (no database access)
    const projectInfo = await Effect.runPromise(res.getProjectBySlug(projectSlug));

    // Connect to database
    const source = provider.getOrCreate(projectInfo.sourceInfo);
    await source.provision();

    // Create project-scoped client
    const db = source.createClient(projectInfo.projectId);

    return new WebDIContext(projectSlug, source, db);
  }

  /**
   * Create a WebDIContext from a ProjectInfo object
   *
   * Useful when you already have project info from the resolver.
   *
   * @param projectInfo - Project info from ProjectsResolver
   * @param sourceProvider - Shared source provider
   * @returns WebDIContext for the project
   */
  static async createFromProjectInfo(
    projectInfo: ProjectInfo,
    sourceProvider: DbSourceProvider
  ): Promise<WebDIContext> {
    const source = sourceProvider.getOrCreate(projectInfo.sourceInfo);
    await source.provision();
    const db = source.createClient(projectInfo.projectId);

    return new WebDIContext(projectInfo.slug, source, db);
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { ProjectsResolver, DbSourceProvider } from "@dev-workflow/tracking";
export type { SourceInfo, ProjectInfo, DbSource, DbClient } from "@dev-workflow/tracking";

/**
 * WebDIContext - Dependency injection context for web package
 *
 * This class provides repository access for a single project, following
 * proper dependency injection patterns:
 * - Constructor injection of projectSlug
 * - Optional registry for testing
 * - Readonly repository properties
 *
 * Usage:
 * ```typescript
 * // In a route handler
 * const context = new WebDIContext(projectSlug);
 * const issues = context.issueRepository.findMany({});
 * ```
 *
 * For multi-project queries, create multiple contexts:
 * ```typescript
 * const registry = new DataSourceRegistry();
 * const { projects } = await registry.getSourcesWithProjects();
 * for (const project of projects) {
 *   const context = new WebDIContext(project.slug, registry);
 *   // ... use context.issueRepository
 * }
 * ```
 */

import {
  DataSourceRegistry,
  type DataSourceProvider,
  type IssueRepository,
  type PlanRepository,
  type TaskRepository,
  type MilestoneRepository,
  IssueStatusService,
} from "@dev-workflow/core";

// =============================================================================
// WebDIContext
// =============================================================================

/**
 * Dependency injection context for web routes
 *
 * Provides access to repositories for a specific project.
 * Use a shared DataSourceRegistry when working with multiple projects
 * to avoid redundant config scanning.
 */
export class WebDIContext {
  /** Repository for issue operations */
  readonly issueRepository: IssueRepository;

  /** Repository for plan operations */
  readonly planRepository: PlanRepository;

  /** Repository for task operations */
  readonly taskRepository: TaskRepository;

  /** Repository for milestone operations */
  readonly milestoneRepository: MilestoneRepository;

  /** Service for computing issue status from task states */
  readonly issueStatusService: IssueStatusService;

  /** Project ID (UUID) */
  readonly projectId: string;

  /** Project slug */
  readonly projectSlug: string;

  /**
   * Create a WebDIContext for a project
   *
   * @param projectSlug - Project slug (e.g., "dev-workflow-b9bccf")
   * @param registry - Optional shared registry (created if not provided)
   */
  private constructor(projectSlug: string, dataSource: DataSourceProvider, projectId: string) {
    this.projectSlug = projectSlug;
    this.projectId = projectId;

    // Create repositories scoped to this project
    this.issueRepository = dataSource.createIssueRepository(projectId);
    this.planRepository = dataSource.createPlanRepository(projectId);
    this.taskRepository = dataSource.createTaskRepository(projectId);
    this.milestoneRepository = dataSource.createMilestoneRepository(projectId);

    // Create status service with injected repositories
    this.issueStatusService = new IssueStatusService(this.planRepository, this.taskRepository);
  }

  /**
   * Create a WebDIContext for a project by slug
   *
   * @param projectSlug - Project slug (e.g., "dev-workflow-b9bccf")
   * @param registry - Optional shared registry (created if not provided)
   * @returns WebDIContext for the project
   * @throws Error if project not found
   */
  static async create(projectSlug: string, registry?: DataSourceRegistry): Promise<WebDIContext> {
    const reg = registry ?? new DataSourceRegistry();
    const dataSource = await reg.getDataSource(projectSlug);

    // Get project ID from database
    const projectRepo = dataSource.getProjectRepository();
    const project = await projectRepo.findBySlug(projectSlug);

    if (!project) {
      throw new Error(`Project not found: ${projectSlug}`);
    }

    return new WebDIContext(projectSlug, dataSource, project.id);
  }

  /**
   * Create a WebDIContext from a ProjectInfo object
   *
   * Useful when you already have project info from the registry.
   *
   * @param projectInfo - Project info from DataSourceRegistry
   * @param registry - Shared registry
   * @returns WebDIContext for the project
   */
  static async createFromProjectInfo(
    projectInfo: { id: string; slug: string },
    registry: DataSourceRegistry
  ): Promise<WebDIContext> {
    const dataSource = await registry.getDataSource(projectInfo.slug);
    return new WebDIContext(projectInfo.slug, dataSource, projectInfo.id);
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { DataSourceRegistry } from "@dev-workflow/core";
export type { SourceInfo, ProjectInfo } from "@dev-workflow/core";

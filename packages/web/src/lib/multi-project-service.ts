import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  SqliteDataSource,
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteMilestoneRepository,
  SqliteProjectRepository,
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  getGlobalDatabasePath,
  resolveGlobalTrackDir,
  NodeGitWorktreeService,
  computeMilestoneStatus,
  resolveConfig,
  loadAllConfigs,
  type Issue,
  type Plan,
  type Task,
  type Milestone,
  type MilestoneIssueStats,
  type WorktreeInfo,
  type TaskStatusHistory,
  type TaskExecutionLog,
  type GitHubIssueSyncConfig,
  type WorkerWithHealth,
  type DispatchQueueEntryWithHealth,
  type ResolvedConfig,
} from "@dev-workflow/core";

/**
 * Represents a data source (database connection).
 *
 * Projects are grouped by data source to allow the UI to:
 * 1. Show a source dropdown (Local, Global, Team DB, etc.)
 * 2. Connect to different databases dynamically
 */
export interface DataSource {
  /** Unique identifier for this source (hash of connection string) */
  readonly id: string;
  /** Display name for the source */
  readonly name: string;
  /** Database connection string (file:// or postgresql://) */
  readonly connectionString: string;
  /** Resolved database path (for SQLite) */
  readonly resolvedPath: string;
  /** Source type for categorization */
  readonly type: "local" | "global" | "remote";
}

/**
 * Represents a project with its ID, name, slug, and track directory
 *
 * Note: gitRoot (local path to repo) is now stored in config.json, not in the
 * database. See project-config-resolver.ts for loading gitRoot from config.
 */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly trackDirectory: string;
  /** Local path to git repository root (loaded from config.json, may be undefined if not configured) */
  readonly gitRoot?: string;
  /** GitHub sync configuration (optional - only present if configured) */
  readonly githubSync?: GitHubIssueSyncConfig | null;
  /** Data source ID this project belongs to */
  readonly sourceId: string;
}

/**
 * Projects grouped by data source for the UI.
 */
export interface ProjectsBySource {
  readonly sources: DataSource[];
  readonly projects: Project[];
}

/**
 * Issue with project context (projectId is already part of Issue)
 */
export type ProjectIssue = Issue;

/**
 * Task with project and issue context
 */
export interface ProjectTask extends Task {
  projectId: string;
  issueNumber: number;
  issueTitle: string;
}

/**
 * Completed task with project and issue context for Done column
 */
export interface CompletedTask extends Task {
  projectId: string;
  projectName: string;
  projectSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
  issueStatus: string;
}

/**
 * Computed issue status based on task states.
 * This replaces the dual display of issue.status + taskPhase with a single status.
 *
 * Status rules:
 * - PLANNED: Issue is in planning phase (not yet activated)
 * - CLOSED: Issue is explicitly closed
 * - TASKS_DONE: All tasks are COMPLETED or ABANDONED (issue ready to be closed)
 * - IN_PROGRESS: Some tasks not completed AND no tasks in BACKLOG/READY (work has started)
 * - OPEN: Plan exists but work not started (tasks in BACKLOG/READY), or no plan/tasks yet
 */
export type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

/**
 * Issue with plan info and project context
 */
export interface ProjectIssueWithPlanInfo {
  issue: ProjectIssue;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
  /**
   * Single computed status based on issue state and task progress.
   * Replaces the previous dual display of issue.status + taskPhase.
   */
  computedStatus: ComputedIssueStatus;
  projectName?: string;
  projectSlug?: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

/**
 * Issue with tasks and project context
 */
export interface ProjectIssueWithTasks {
  issue: ProjectIssue;
  plan: Plan | null;
  tasks: Task[];
  milestoneNumber?: number;
  milestoneTitle?: string;
  projectName?: string;
  projectSlug?: string;
}

/**
 * Milestone with project name and slug for display and navigation
 */
export interface MilestoneWithProject extends Milestone {
  projectName: string;
  projectSlug: string;
}

/**
 * Milestone with associated issues and progress
 */
export interface MilestoneWithIssues {
  milestone: MilestoneWithProject;
  issues: {
    number: number;
    title: string;
    status: string;
    computedStatus: ComputedIssueStatus;
    type: string;
  }[];
  progress: {
    total: number;
    closed: number;
    percentage: number;
  };
}

/**
 * Worktree with project context and optional task association
 */
export interface ProjectWorktree {
  projectId: string;
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  diskUsageBytes?: number;
  // Task association (if any)
  taskId?: string;
  taskNumber?: number;
  taskTitle?: string;
  taskStatus?: string;
  issueNumber?: number;
}

/**
 * Extended dispatch queue entry with task details
 */
export interface DispatchQueueEntryWithDetails extends DispatchQueueEntryWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskTitle?: string;
}

/**
 * Worker data combining workers, queue, and stats
 */
export interface WorkerData {
  workers: WorkerWithHealth[];
  queue: DispatchQueueEntryWithDetails[];
  stats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

/**
 * Cached database connection with its repositories
 */
interface DatabaseConnection {
  dbService: SqliteDataSource;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  projectRepository: SqliteProjectRepository;
}

/**
 * Create a source ID from a connection string
 */
function createSourceId(connectionString: string): string {
  // Use a simple hash of the connection string
  let hash = 0;
  for (let i = 0; i < connectionString.length; i++) {
    const char = connectionString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get the source type from a connection string
 */
function getSourceType(connectionString: string): "local" | "global" | "remote" {
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    return "remote";
  }
  if (connectionString.startsWith("file:./") || connectionString.includes(".track/workflow.db")) {
    return "local";
  }
  if (connectionString.startsWith("file:///")) {
    return "global";
  }
  return "local";
}

/**
 * Get a display name for a data source
 */
function getSourceName(connectionString: string, resolvedPath: string): string {
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    // Extract host from URL
    try {
      const url = new URL(connectionString);
      return `Remote: ${url.host}`;
    } catch {
      return "Remote Database";
    }
  }
  if (connectionString.startsWith("file:./")) {
    return "Local Database";
  }
  if (resolvedPath.includes("/.track/workflow.db")) {
    return "Global Database";
  }
  return path.basename(resolvedPath);
}

/**
 * MultiProjectService manages access to multiple databases
 * and provides aggregated views of issues and tasks across all projects.
 *
 * Key capabilities:
 * - Scans config.json files in ~/.track/<slug>/ directories
 * - Groups projects by database connection string
 * - Connects to databases on demand (lazy connection)
 * - Caches database connections for reuse
 */
export class MultiProjectService {
  /** Cache of database connections by resolved path */
  private connections: Map<string, DatabaseConnection> = new Map();

  /** Reference to global database service (for backwards compatibility) */
  private dbService: SqliteDataSource | null = null;

  constructor(private readonly globalTrackDir: string = resolveGlobalTrackDir()) {}

  /**
   * Get the global database path (for backwards compatibility)
   */
  private getDatabasePath(): string {
    return getGlobalDatabasePath();
  }

  /**
   * Scan all config.json files and build data sources.
   * This is the primary discovery mechanism.
   */
  async scanDataSources(): Promise<{ sources: DataSource[]; configs: ResolvedConfig[] }> {
    const configs = await loadAllConfigs();

    // Group by resolved database path
    const sourcesByPath = new Map<string, { config: ResolvedConfig; connectionString: string }>();
    for (const config of configs) {
      if (!sourcesByPath.has(config.resolvedDatabase)) {
        sourcesByPath.set(config.resolvedDatabase, {
          config,
          connectionString: config.database,
        });
      }
    }

    // Build data sources
    const sources: DataSource[] = [];
    for (const [resolvedPath, { connectionString }] of sourcesByPath) {
      sources.push({
        id: createSourceId(connectionString),
        name: getSourceName(connectionString, resolvedPath),
        connectionString,
        resolvedPath,
        type: getSourceType(connectionString),
      });
    }

    // Sort: global first, then local, then remote
    sources.sort((a, b) => {
      const order = { global: 0, local: 1, remote: 2 };
      return order[a.type] - order[b.type];
    });

    return { sources, configs };
  }

  /**
   * Get a database connection for a specific path.
   * Creates and caches the connection if it doesn't exist.
   */
  private async getConnection(dbPath: string): Promise<DatabaseConnection> {
    // Check cache
    const existing = this.connections.get(dbPath);
    if (existing) {
      return existing;
    }

    // Check if database exists
    try {
      await fs.access(dbPath);
    } catch {
      throw new Error(`Database not found at ${dbPath}. Run 'dev-workflow init' first.`);
    }

    // Create new connection
    const dbService = await SqliteDataSource.create(dbPath);
    dbService.runMigrations();
    const db = dbService.getDb();

    const connection: DatabaseConnection = {
      dbService,
      planRepository: new SqlitePlanRepository(db),
      taskRepository: new SqliteTaskRepository(db),
      projectRepository: new SqliteProjectRepository(db),
    };

    this.connections.set(dbPath, connection);
    return connection;
  }

  /**
   * Initialize the database connection (lazy) - for backwards compatibility.
   * Uses the global database path.
   */
  private async ensureConnection(): Promise<{
    planRepository: SqlitePlanRepository;
    taskRepository: SqliteTaskRepository;
    projectRepository: SqliteProjectRepository;
  }> {
    const dbPath = this.getDatabasePath();
    const connection = await this.getConnection(dbPath);
    // Keep reference to dbService for backwards compatibility
    this.dbService = connection.dbService;
    return {
      planRepository: connection.planRepository,
      taskRepository: connection.taskRepository,
      projectRepository: connection.projectRepository,
    };
  }

  /**
   * Get an issue repository for a specific project
   */
  private async getIssueRepository(projectId: string): Promise<SqliteIssueRepository> {
    await this.ensureConnection();
    const db = this.dbService!.getDb();
    return new SqliteIssueRepository(db, projectId);
  }

  /**
   * Get a milestone repository for a specific project
   */
  private async getMilestoneRepository(projectId: string): Promise<SqliteMilestoneRepository> {
    await this.ensureConnection();
    const db = this.dbService!.getDb();
    return new SqliteMilestoneRepository(db, projectId);
  }

  /**
   * List all projects grouped by data source.
   *
   * This is the primary method for the UI - scans config.json files to discover
   * all projects and groups them by database connection.
   */
  async listProjectsBySource(): Promise<ProjectsBySource> {
    const { sources, configs } = await this.scanDataSources();

    // For each config, load project from its database
    const projects: Project[] = [];

    for (const config of configs) {
      try {
        const connection = await this.getConnection(config.resolvedDatabase);
        const coreProject = connection.projectRepository.findBySlug(config.slug);

        if (!coreProject) {
          // Project exists in config but not in database - skip
          continue;
        }

        // Compute track directory
        const hash = coreProject.gitRootHash.slice(0, 6);
        const trackDirName = `${coreProject.name}-${hash}`;
        const trackDirectory = path.join(this.globalTrackDir, trackDirName);

        // Find the source for this project
        const sourceId = createSourceId(config.database);

        projects.push({
          id: coreProject.id,
          name: coreProject.name,
          slug: coreProject.slug,
          trackDirectory,
          gitRoot: config.gitRoot,
          githubSync: coreProject.githubSync ?? null,
          sourceId,
        });
      } catch {
        // Database not accessible or project not found - skip
      }
    }

    // Sort by name
    projects.sort((a, b) => a.name.localeCompare(b.name));

    return { sources, projects };
  }

  /**
   * List all projects from the database (backwards compatible).
   *
   * Note: This uses the global database only. For multi-source support,
   * use listProjectsBySource() instead.
   */
  async listProjects(): Promise<Project[]> {
    const { projectRepository } = await this.ensureConnection();
    const coreProjects = projectRepository.findAll();

    // Get global source ID
    const globalDbPath = this.getDatabasePath();
    const globalSourceId = createSourceId(`file:///${globalDbPath}`);

    // Map core projects to UI projects with track directory and gitRoot
    const projects: Project[] = await Promise.all(
      coreProjects.map(async (p) => {
        // Compute track directory from project name and git root hash
        const hash = p.gitRootHash.slice(0, 6);
        const trackDirName = `${p.name}-${hash}`;
        const trackDirectory = path.join(this.globalTrackDir, trackDirName);

        // Try to load gitRoot from config.json
        let gitRoot: string | undefined;
        try {
          const config = await resolveConfig(p.slug);
          gitRoot = config.gitRoot;
        } catch {
          // Config doesn't exist yet, gitRoot will be undefined
        }

        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          trackDirectory,
          gitRoot,
          githubSync: p.githubSync ?? null,
          sourceId: globalSourceId,
        };
      })
    );

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Find a project by slug.
   * Returns the project if found, null otherwise.
   */
  async findProject(slug: string): Promise<Project | null> {
    // First try to find config for this slug
    try {
      const config = await resolveConfig(slug);
      const connection = await this.getConnection(config.resolvedDatabase);
      const coreProject = connection.projectRepository.findBySlug(slug);

      if (!coreProject) {
        return null;
      }

      // Build the full Project with trackDirectory and gitRoot
      const hash = coreProject.gitRootHash.slice(0, 6);
      const trackDirName = `${coreProject.name}-${hash}`;
      const trackDirectory = path.join(this.globalTrackDir, trackDirName);

      return {
        id: coreProject.id,
        name: coreProject.name,
        slug: coreProject.slug,
        trackDirectory,
        gitRoot: config.gitRoot,
        githubSync: coreProject.githubSync ?? null,
        sourceId: createSourceId(config.database),
      };
    } catch {
      // Config not found, try global database for backwards compatibility
      const { projectRepository } = await this.ensureConnection();
      const coreProject = projectRepository.findBySlug(slug);

      if (!coreProject) {
        return null;
      }

      const hash = coreProject.gitRootHash.slice(0, 6);
      const trackDirName = `${coreProject.name}-${hash}`;
      const trackDirectory = path.join(this.globalTrackDir, trackDirName);
      const globalDbPath = this.getDatabasePath();

      return {
        id: coreProject.id,
        name: coreProject.name,
        slug: coreProject.slug,
        trackDirectory,
        gitRoot: undefined,
        githubSync: coreProject.githubSync ?? null,
        sourceId: createSourceId(`file:///${globalDbPath}`),
      };
    }
  }

  /**
   * List all issues across all projects (or filtered by project)
   */
  async listIssues(projectFilter?: string): Promise<ProjectIssueWithPlanInfo[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const { planRepository, taskRepository } = await this.ensureConnection();
    const allIssues: ProjectIssueWithPlanInfo[] = [];

    for (const project of filteredProjects) {
      const issueRepository = await this.getIssueRepository(project.id);
      const milestoneRepository = await this.getMilestoneRepository(project.id);
      const issues = issueRepository.findMany({});

      for (const issue of issues) {
        const plan = planRepository.findByIssueId(issue.id);
        let taskCounts: ProjectIssueWithPlanInfo["taskCounts"];
        let computedStatus: ComputedIssueStatus;

        // Compute single status based on issue state and task progress
        if (issue.status === "PLANNED") {
          // Issue is in planning phase (not yet activated)
          computedStatus = "PLANNED";
        } else if (issue.status === "CLOSED") {
          // Issue explicitly closed
          computedStatus = "CLOSED";
        } else if (!plan) {
          // No plan/tasks yet
          computedStatus = "OPEN";
        } else {
          const tasks = taskRepository.findByPlanId(plan.id);
          const completed = tasks.filter((t) => t.status === "COMPLETED").length;
          const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
          const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
          const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

          taskCounts = {
            total: tasks.length,
            completed,
            inProgress: inProgress + prReview, // Include PR_REVIEW in "in progress" count
          };

          if (tasks.length === 0) {
            // Plan exists but no tasks yet
            computedStatus = "OPEN";
          } else if (completed + abandoned === tasks.length) {
            // All tasks COMPLETED or ABANDONED - issue ready to be closed
            computedStatus = "TASKS_DONE";
          } else if (inProgress === 0 && prReview === 0) {
            // No tasks have progressed past READY (all are BACKLOG, READY, or terminal)
            computedStatus = "OPEN";
          } else {
            // At least one task is IN_PROGRESS or PR_REVIEW (work has started)
            computedStatus = "IN_PROGRESS";
          }
        }

        // Get milestone info if issue is assigned to one
        let milestoneNumber: number | undefined;
        let milestoneTitle: string | undefined;

        if (issue.milestoneId) {
          const milestone = milestoneRepository.findById(issue.milestoneId);
          if (milestone) {
            milestoneNumber = milestone.number;
            milestoneTitle = milestone.title;
          }
        }

        allIssues.push({
          issue,
          hasPlan: !!plan,
          taskCounts,
          computedStatus,
          projectName: project.name,
          projectSlug: project.slug,
          milestoneNumber,
          milestoneTitle,
        });
      }
    }

    // Sort by project, then by number descending
    return allIssues.sort((a, b) => {
      if (a.issue.projectId !== b.issue.projectId) {
        return a.issue.projectId.localeCompare(b.issue.projectId);
      }
      return b.issue.number - a.issue.number;
    });
  }

  /**
   * Get a single issue by project and number
   */
  async getIssue(
    projectId: string,
    issueNumber: number
  ): Promise<{ issue: ProjectIssue; plan: Plan | null; tasks: Task[] } | null> {
    const { planRepository, taskRepository } = await this.ensureConnection();
    const issueRepository = await this.getIssueRepository(projectId);

    const issue = issueRepository.findByNumber(issueNumber);
    if (!issue) return null;

    const plan = planRepository.findByIssueId(issue.id);
    const tasks = plan ? taskRepository.findByPlanId(plan.id) : [];

    return {
      issue,
      plan,
      tasks,
    };
  }

  /**
   * List all tasks across all projects (for kanban board)
   */
  async listTasks(projectFilter?: string): Promise<ProjectIssueWithTasks[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const { planRepository, taskRepository } = await this.ensureConnection();
    const allIssuesWithTasks: ProjectIssueWithTasks[] = [];

    for (const project of filteredProjects) {
      const issueRepository = await this.getIssueRepository(project.id);
      const milestoneRepository = await this.getMilestoneRepository(project.id);
      const issues = issueRepository.findMany({});

      for (const issue of issues) {
        // Skip closed issues - they shouldn't appear in the kanban board
        if (issue.status === "CLOSED") {
          continue;
        }

        const plan = planRepository.findByIssueId(issue.id);
        const tasks = plan ? taskRepository.findByPlanId(plan.id) : [];

        // Get milestone info if issue is assigned to one
        let milestoneNumber: number | undefined;
        let milestoneTitle: string | undefined;

        if (issue.milestoneId) {
          const milestone = milestoneRepository.findById(issue.milestoneId);
          if (milestone) {
            milestoneNumber = milestone.number;
            milestoneTitle = milestone.title;
          }
        }

        // Include all non-closed issues (even without plans/tasks)
        // Issues without plans need to appear in the work queue so they get planned
        allIssuesWithTasks.push({
          issue,
          plan,
          tasks,
          milestoneNumber,
          milestoneTitle,
          projectName: project.name,
          projectSlug: project.slug,
        });
      }
    }

    return allIssuesWithTasks;
  }

  /**
   * List completed tasks for the Done column across all projects.
   */
  async listCompletedTasks(projectFilter?: string): Promise<CompletedTask[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const { planRepository, taskRepository } = await this.ensureConnection();
    const allCompletedTasks: CompletedTask[] = [];

    // Calculate cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffDateStr = cutoffDate.toISOString();

    for (const project of filteredProjects) {
      const issueRepository = await this.getIssueRepository(project.id);
      const issues = issueRepository.findMany({});

      for (const issue of issues) {
        const plan = planRepository.findByIssueId(issue.id);
        if (!plan) continue;

        const tasks = taskRepository.findByPlanId(plan.id);

        for (const task of tasks) {
          // Only include completed or abandoned tasks
          if (task.status !== "COMPLETED" && task.status !== "ABANDONED") {
            continue;
          }

          // Check if completed within the last 7 days
          const completionDate = task.completedAt ?? task.abandonedAt;
          if (!completionDate || completionDate < cutoffDateStr) {
            continue;
          }

          allCompletedTasks.push({
            ...task,
            projectId: issue.projectId,
            projectName: project.name,
            projectSlug: project.slug,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueType: issue.type,
            issueStatus: issue.status,
          });
        }
      }
    }

    // Sort by completion date descending (most recent first)
    allCompletedTasks.sort((a, b) => {
      const dateA = a.completedAt ?? a.abandonedAt ?? "";
      const dateB = b.completedAt ?? b.abandonedAt ?? "";
      return dateB.localeCompare(dateA);
    });

    // Limit to 20 tasks
    return allCompletedTasks.slice(0, 20);
  }

  /**
   * List all milestones across all projects (or filtered by project)
   */
  async listMilestones(projectFilter?: string): Promise<MilestoneWithIssues[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const { planRepository, taskRepository } = await this.ensureConnection();
    const allMilestones: MilestoneWithIssues[] = [];

    for (const project of filteredProjects) {
      const milestoneRepository = await this.getMilestoneRepository(project.id);
      const issueRepository = await this.getIssueRepository(project.id);
      const milestones = milestoneRepository.findMany();

      for (const milestone of milestones) {
        const issues = issueRepository.findMany({ milestoneId: milestone.id });
        const closedIssues = issues.filter((i) => i.status === "CLOSED").length;

        // Compute milestone status from issue states
        const milestoneIssueStats: MilestoneIssueStats = {
          totalIssues: issues.length,
          closedIssues,
          openOrInProgressIssues: issues.filter(
            (i) => i.status === "OPEN" || i.status === "IN_PROGRESS"
          ).length,
        };
        const computedMilestoneStatus = computeMilestoneStatus(
          milestone.status,
          milestoneIssueStats,
          milestone.endDate
        );

        // Compute status for each issue
        const issuesWithComputedStatus = issues.map((issue) => {
          let computedStatus: ComputedIssueStatus;

          if (issue.status === "PLANNED") {
            computedStatus = "PLANNED";
          } else if (issue.status === "CLOSED") {
            computedStatus = "CLOSED";
          } else {
            const plan = planRepository.findByIssueId(issue.id);
            if (!plan) {
              computedStatus = "OPEN";
            } else {
              const tasks = taskRepository.findByPlanId(plan.id);
              if (tasks.length === 0) {
                computedStatus = "OPEN";
              } else {
                const completed = tasks.filter((t) => t.status === "COMPLETED").length;
                const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
                const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
                const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

                if (completed + abandoned === tasks.length) {
                  computedStatus = "TASKS_DONE";
                } else if (inProgress === 0 && prReview === 0) {
                  computedStatus = "OPEN";
                } else {
                  computedStatus = "IN_PROGRESS";
                }
              }
            }
          }

          return {
            number: issue.number,
            title: issue.title,
            status: issue.status,
            computedStatus,
            type: issue.type,
          };
        });

        allMilestones.push({
          milestone: {
            id: milestone.id,
            number: milestone.number,
            title: milestone.title,
            description: milestone.description,
            startDate: milestone.startDate,
            endDate: milestone.endDate,
            status: computedMilestoneStatus,
            projectId: milestone.projectId,
            projectName: project.name,
            projectSlug: project.slug,
            createdAt: milestone.createdAt,
            updatedAt: milestone.updatedAt,
          },
          issues: issuesWithComputedStatus,
          progress: {
            total: issues.length,
            closed: closedIssues,
            percentage: issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
          },
        });
      }
    }

    // Sort by start date
    return allMilestones.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));
  }

  /**
   * List all worktrees across all projects (or filtered by project)
   */
  async listWorktrees(projectFilter?: string): Promise<ProjectWorktree[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const { planRepository, taskRepository } = await this.ensureConnection();
    const allWorktrees: ProjectWorktree[] = [];

    for (const project of filteredProjects) {
      // gitRoot is loaded from config.json in listProjects
      // Skip projects without gitRoot (config.json not set up yet)
      if (!project.gitRoot) continue;

      // Get worktrees from git
      const worktreeService = new NodeGitWorktreeService(project.gitRoot);
      let worktrees: WorktreeInfo[];
      try {
        worktrees = await worktreeService.listWorktrees();
      } catch {
        continue;
      }

      // Get all tasks with worktree paths for this project
      const issueRepository = await this.getIssueRepository(project.id);
      const issues = issueRepository.findMany({});
      const tasksByWorktreePath = new Map<string, { task: Task; issueNumber: number }>();

      for (const issue of issues) {
        const plan = planRepository.findByIssueId(issue.id);
        if (!plan) continue;

        const tasks = taskRepository.findByPlanId(plan.id);
        for (const task of tasks) {
          if (task.worktreePath) {
            // Worktree paths are stored in ~/.track/{projectId}/worktrees/
            // They can be absolute or relative to the track directory
            const fullPath = path.isAbsolute(task.worktreePath)
              ? task.worktreePath
              : path.resolve(project.trackDirectory, task.worktreePath);
            tasksByWorktreePath.set(fullPath, { task, issueNumber: issue.number });
          }
        }
      }

      // Map worktrees to ProjectWorktree with task associations
      for (const wt of worktrees) {
        if (wt.isMain) continue; // Skip main worktree

        const taskInfo = tasksByWorktreePath.get(wt.path);
        allWorktrees.push({
          projectId: project.id,
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          isMain: wt.isMain,
          diskUsageBytes: wt.diskUsageBytes,
          taskId: taskInfo?.task.id,
          taskNumber: taskInfo?.task.number,
          taskTitle: taskInfo?.task.title,
          taskStatus: taskInfo?.task.status,
          issueNumber: taskInfo?.issueNumber,
        });
      }
    }

    return allWorktrees;
  }

  /**
   * Prune stale worktrees for a project
   */
  async pruneWorktrees(projectId: string): Promise<{ pruned: number }> {
    const projects = await this.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // gitRoot is loaded from config.json in listProjects
    if (!project.gitRoot) {
      throw new Error(
        "Project config.json not found. Run 'dev-workflow init' in the project directory first."
      );
    }

    const worktreeService = new NodeGitWorktreeService(project.gitRoot);

    // Get worktree count before pruning
    const beforeCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

    await worktreeService.pruneWorktrees();

    // Get worktree count after pruning
    const afterCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

    return { pruned: beforeCount - afterCount };
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const { taskRepository } = await this.ensureConnection();
    return taskRepository.findById(taskId);
  }

  /**
   * Get status history for a task
   */
  async getTaskStatusHistory(taskId: string): Promise<TaskStatusHistory[]> {
    const { taskRepository } = await this.ensureConnection();
    return taskRepository.getStatusHistory(taskId);
  }

  /**
   * Get execution logs for a task
   */
  async getTaskExecutionLogs(taskId: string): Promise<TaskExecutionLog[]> {
    const { taskRepository } = await this.ensureConnection();
    return taskRepository.getExecutionLogs(taskId);
  }

  /**
   * Get dependency tasks for a task
   *
   * Returns the tasks that this task depends on with their current status.
   */
  async getTaskDependencies(taskId: string): Promise<Task[]> {
    const { taskRepository } = await this.ensureConnection();
    const task = taskRepository.findById(taskId);
    if (!task || !task.dependsOn || task.dependsOn.length === 0) {
      return [];
    }
    return taskRepository.findByIds(task.dependsOn);
  }

  /**
   * Get worker data including workers, dispatch queue, and stats
   *
   * Workers are global (not project-scoped) since they can work on
   * tasks from any project in the dev-workflow installation.
   */
  async getWorkerData(): Promise<WorkerData> {
    await this.ensureConnection();
    const db = this.dbService!.getDb();

    const workerRepository = new SqliteWorkerRepository(db);
    const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

    // Get workers with health info
    const workers = workerRepository.findAllWithHealth();

    // Get queue entries with health info
    const queueEntries = dispatchQueueRepository.findAllWithHealth();

    // Get stats
    const stats = dispatchQueueRepository.getQueueStats();

    // Enrich queue entries with task details
    const { planRepository, taskRepository } = await this.ensureConnection();
    const projects = await this.listProjects();

    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];

    for (const entry of queueEntries) {
      // Find the task
      const task = taskRepository.findById(entry.taskId);
      if (!task) {
        // Task not found, include entry without details
        enrichedQueue.push({
          ...entry,
          taskNumber: undefined,
          issueNumber: undefined,
          taskTitle: undefined,
        });
        continue;
      }

      // Find the plan to get the issue
      const plan = planRepository.findById(task.planId);
      if (!plan) {
        enrichedQueue.push({
          ...entry,
          taskNumber: task.number,
          issueNumber: undefined,
          taskTitle: task.title,
        });
        continue;
      }

      // Find the issue
      let issueNumber: number | undefined;
      for (const project of projects) {
        const issueRepository = await this.getIssueRepository(project.id);
        const issue = issueRepository.findById(plan.issueId);
        if (issue) {
          issueNumber = issue.number;
          break;
        }
      }

      enrichedQueue.push({
        ...entry,
        taskNumber: task.number,
        issueNumber,
        taskTitle: task.title,
      });
    }

    return {
      workers,
      queue: enrichedQueue,
      stats,
    };
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    // Close all cached connections
    for (const connection of this.connections.values()) {
      connection.dbService.close();
    }
    this.connections.clear();
    this.dbService = null;
  }
}

// Singleton instance for API routes
let serviceInstance: MultiProjectService | null = null;

export function getMultiProjectService(): MultiProjectService {
  if (!serviceInstance) {
    serviceInstance = new MultiProjectService();
  }
  return serviceInstance;
}

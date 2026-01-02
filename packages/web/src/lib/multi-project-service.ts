import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import {
  DatabaseService,
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteMilestoneRepository,
  getGlobalDatabasePath,
  NodeGitWorktreeService,
  type Issue,
  type Plan,
  type Task,
  type Milestone,
  type WorktreeInfo,
  type TaskStatusHistory,
  type TaskExecutionLog,
} from "@dev-workflow/core";

/**
 * Represents a project with its ID and track directory
 */
export interface Project {
  readonly id: string;
  readonly trackDirectory: string;
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
  issueNumber: number;
  issueTitle: string;
  issueStatus: string;
}

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
}

/**
 * Milestone with associated issues and progress
 */
export interface MilestoneWithIssues {
  milestone: Milestone;
  issues: {
    number: number;
    title: string;
    status: string;
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
 * MultiProjectService manages access to the global database
 * and provides aggregated views of issues and tasks across all projects.
 */
export class MultiProjectService {
  private dbService: DatabaseService | null = null;
  private planRepository: SqlitePlanRepository | null = null;
  private taskRepository: SqliteTaskRepository | null = null;

  constructor(private readonly globalTrackDir: string = path.join(os.homedir(), ".track")) {}

  /**
   * Get the global database path
   */
  private getDatabasePath(): string {
    return getGlobalDatabasePath();
  }

  /**
   * Initialize the database connection (lazy)
   */
  private async ensureConnection(): Promise<{
    planRepository: SqlitePlanRepository;
    taskRepository: SqliteTaskRepository;
  }> {
    if (this.dbService && this.planRepository && this.taskRepository) {
      return { planRepository: this.planRepository, taskRepository: this.taskRepository };
    }

    const dbPath = this.getDatabasePath();

    // Check if database exists
    try {
      await fs.access(dbPath);
    } catch {
      throw new Error(`Global database not found at ${dbPath}. Run 'dev-workflow init' first.`);
    }

    this.dbService = await DatabaseService.create(dbPath);
    const db = this.dbService.getDb();
    this.planRepository = new SqlitePlanRepository(db);
    this.taskRepository = new SqliteTaskRepository(db);

    return { planRepository: this.planRepository, taskRepository: this.taskRepository };
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
   * List all projects in the global track directory
   */
  async listProjects(): Promise<Project[]> {
    const projects: Project[] = [];

    try {
      const entries = await fs.readdir(this.globalTrackDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip the workflow.db file and hidden directories
        if (entry.name.startsWith(".") || entry.name === "workflow.db") continue;

        const projectId = entry.name;
        const trackDirectory = path.join(this.globalTrackDir, projectId);

        // Verify config.json exists (indicates valid project)
        try {
          await fs.access(path.join(trackDirectory, "config.json"));
          projects.push({ id: projectId, trackDirectory });
        } catch {
          // Skip directories without config (not valid projects)
          continue;
        }
      }
    } catch {
      // Global track directory doesn't exist - return empty list
      return [];
    }

    return projects.sort((a, b) => a.id.localeCompare(b.id));
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
      const issues = issueRepository.findMany({});

      for (const issue of issues) {
        const plan = planRepository.findByIssueId(issue.id);
        let taskCounts: ProjectIssueWithPlanInfo["taskCounts"];

        if (plan) {
          const tasks = taskRepository.findByPlanId(plan.id);
          const completed = tasks.filter((t) => t.status === "COMPLETED").length;
          const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;

          taskCounts = {
            total: tasks.length,
            completed,
            inProgress,
          };
        }

        allIssues.push({
          issue,
          hasPlan: !!plan,
          taskCounts,
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
  async listTasks(
    projectFilter?: string,
    issueFilter?: number
  ): Promise<ProjectIssueWithTasks[]> {
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
        // Apply issue filter if specified
        if (issueFilter !== undefined && issue.number !== issueFilter) {
          continue;
        }

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

        // Only include issues that have tasks
        if (tasks.length > 0) {
          allIssuesWithTasks.push({
            issue,
            plan,
            tasks,
            milestoneNumber,
            milestoneTitle,
          });
        }
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
            issueNumber: issue.number,
            issueTitle: issue.title,
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

    await this.ensureConnection();
    const allMilestones: MilestoneWithIssues[] = [];

    for (const project of filteredProjects) {
      const milestoneRepository = await this.getMilestoneRepository(project.id);
      const issueRepository = await this.getIssueRepository(project.id);
      const milestones = milestoneRepository.findMany();

      for (const milestone of milestones) {
        const issues = issueRepository.findMany({ milestoneId: milestone.id });
        const closedIssues = issues.filter((i) => i.status === "CLOSED").length;

        allMilestones.push({
          milestone,
          issues: issues.map((i) => ({
            number: i.number,
            title: i.title,
            status: i.status,
            type: i.type,
          })),
          progress: {
            total: issues.length,
            closed: closedIssues,
            percentage: issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
          },
        });
      }
    }

    // Sort by start date
    return allMilestones.sort(
      (a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate)
    );
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
      // Get project root from config
      const configPath = path.join(project.trackDirectory, "config.json");
      let gitRoot: string;
      try {
        const configContent = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(configContent);
        gitRoot = config.gitRoot;
        if (!gitRoot) continue;
      } catch {
        continue;
      }

      // Get worktrees from git
      const worktreeService = new NodeGitWorktreeService(gitRoot);
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

    // Get git root from config (needed to run git worktree commands)
    const configPath = path.join(project.trackDirectory, "config.json");
    let gitRoot: string;
    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);
      gitRoot = config.gitRoot;
      if (!gitRoot) {
        throw new Error("Git root not configured");
      }
    } catch (error) {
      throw new Error(`Failed to read project config: ${error}`);
    }

    const worktreeService = new NodeGitWorktreeService(gitRoot);

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
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.dbService) {
      this.dbService.close();
      this.dbService = null;
      this.planRepository = null;
      this.taskRepository = null;
    }
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

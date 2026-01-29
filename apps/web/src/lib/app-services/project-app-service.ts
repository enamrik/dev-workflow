/**
 * ProjectAppService - Application service for project and cross-project operations
 *
 * This service handles:
 * - Listing and getting individual projects
 * - Cross-project queries (issues, tasks, milestones across all projects)
 * - Worker and worktree listing
 */

import {
  ProjectsResolver,
  DbSourceProvider,
  IssueStatusService,
  BoardQueryService,
  resolveConfig,
  EntityNotFoundError,
  computeMilestoneStatus,
  isIssueClosed,
  isIssueInPlanning,
  type ProjectInfo,
  type Issue,
  type Plan,
  type Task,
  type Milestone,
  type ComputedIssueStatus,
  type TaskCounts,
  type WorkerTaskAssignment,
  type DbClient,
  type MilestoneIssueStats,
} from "@dev-workflow/tracking";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import {
  NodeGitWorktreeService,
  type WorktreeInfo,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { WorkerWithHealth } from "@dev-workflow/dispatch/worker.js";
import type { QueueEntryWithHealth } from "@dev-workflow/dispatch/worker-queue-db.js";

// =============================================================================
// Types
// =============================================================================

export interface ProjectWithStats {
  projectId: string;
  name: string;
  slug: string;
  issueCount: number;
  taskCount: number;
}

export interface IssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: TaskCounts;
  computedStatus: ComputedIssueStatus;
  projectName?: string;
  projectSlug?: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

export interface TaskWithWorker extends Task {
  workerId?: string;
  workerName?: string;
}

export interface IssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: TaskWithWorker[];
  milestoneNumber?: number;
  milestoneTitle?: string;
  projectName?: string;
  projectSlug?: string;
}

export interface CompletedTaskWithContext extends Task {
  projectId: string;
  projectName: string;
  projectSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  issueStatus: string;
}

export interface BoardTasksResult {
  issuesWithTasks: IssueWithTasks[];
  completedTasks: CompletedTaskWithContext[];
}

export interface MilestoneWithProject extends Milestone {
  projectSlug: string;
  projectName: string;
}

export interface WorkerInfo {
  workerId: string;
  workerName: string | null;
  taskId: string;
  status: string;
  isStale: boolean;
}

export interface ProjectApiInfo {
  id: string;
  name: string;
  slug: string;
  gitRoot: string;
  syncConfig: object | null;
}

export interface DispatchQueueEntryWithDetails extends QueueEntryWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskTitle?: string;
  totalTasks?: number;
}

export interface WorkerWithTaskDetails extends WorkerWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskStartedAt?: string;
  totalTasks?: number;
}

export interface WorkerDataResult {
  workers: WorkerWithTaskDetails[];
  queue: DispatchQueueEntryWithDetails[];
  stats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

interface TaskDetails {
  taskNumber: number;
  issueNumber: number;
  taskTitle: string;
  taskStartedAt: string | null;
  totalTasks: number;
}

export interface ProjectWorktree {
  projectId: string;
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  diskUsageBytes?: number;
  taskId?: string;
  taskNumber?: number;
  taskTitle?: string;
  taskStatus?: string;
  issueNumber?: number;
}

export interface PruneWorktreesResult {
  success: boolean;
  pruned: number;
}

export interface MilestoneIssueInfo {
  number: number;
  title: string;
  status: string;
  computedStatus: ComputedIssueStatus;
  type: string;
}

export interface MilestoneProgress {
  total: number;
  closed: number;
  percentage: number;
}

export interface MilestoneWithDetails {
  milestone: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    startDate: string;
    endDate: string;
    status: string;
    projectId: string;
    createdAt: string;
    updatedAt: string;
    projectName: string;
    projectSlug: string;
  };
  issues: MilestoneIssueInfo[];
  progress: MilestoneProgress;
}

export interface TaskDependencyWithIssue extends Task {
  issueNumber: number | null;
}

// =============================================================================
// ProjectAppService
// =============================================================================

export class ProjectAppService {
  constructor(
    private readonly projectsResolver: ProjectsResolver,
    private readonly sourceProvider: DbSourceProvider
  ) {}

  /**
   * List all projects with GitHub sync configuration
   */
  async listProjectsWithSync(): Promise<ProjectApiInfo[]> {
    const projects = await this.projectsResolver.getAllProjects();

    // Enrich projects with database data (syncConfig)
    const enrichedProjects = await this.projectsResolver.enrichWithDbData(
      projects,
      async (sourceInfo) => {
        const source = this.sourceProvider.getOrCreate(sourceInfo);
        await source.provision();
        return source;
      }
    );

    return enrichedProjects.map((p) => ({
      id: p.projectId,
      name: p.name,
      slug: p.slug,
      gitRoot: p.gitRoot,
      syncConfig: p.syncConfig ?? null,
    }));
  }

  /**
   * List all projects with basic stats
   */
  async listProjects(): Promise<ProjectWithStats[]> {
    const projects = await this.projectsResolver.getAllProjects();
    const result: ProjectWithStats[] = [];

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const issues = db.issues.findMany({});
        const plans = issues.map((i) => db.plans.findByIssueId(i.id)).filter(Boolean);
        const taskCount = plans.reduce((sum, plan) => {
          return sum + (plan ? db.tasks.findByPlanId(plan.id).length : 0);
        }, 0);

        result.push({
          projectId: project.projectId,
          name: project.name,
          slug: project.slug,
          issueCount: issues.length,
          taskCount,
        });
      } catch {
        // Skip inaccessible projects
      }
    }

    return result;
  }

  /**
   * Get a single project by slug
   */
  async getProject(projectSlug: string): Promise<ProjectInfo> {
    return this.projectsResolver.getProjectBySlug(projectSlug);
  }

  /**
   * List all issues across projects
   */
  async listAllIssues(projectFilter?: string): Promise<IssueWithPlanInfo[]> {
    let projects = await this.projectsResolver.getAllProjects();

    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    const allIssues: IssueWithPlanInfo[] = [];

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const issues = db.issues.findMany({});
        const statusService = new IssueStatusService(db);

        for (const issue of issues) {
          const { computedStatus, taskCounts } = statusService.computeStatus(issue);

          let milestoneNumber: number | undefined;
          let milestoneTitle: string | undefined;
          if (issue.milestoneId) {
            const milestone = db.milestones.findById(issue.milestoneId);
            if (milestone) {
              milestoneNumber = milestone.number;
              milestoneTitle = milestone.title;
            }
          }

          allIssues.push({
            issue,
            hasPlan: !!db.plans.findByIssueId(issue.id),
            taskCounts,
            computedStatus,
            projectName: project.name,
            projectSlug: project.slug,
            milestoneNumber,
            milestoneTitle,
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort by project, then by issue number descending
    allIssues.sort((a, b) => {
      if (a.issue.projectId !== b.issue.projectId) {
        return a.issue.projectId.localeCompare(b.issue.projectId);
      }
      return b.issue.number - a.issue.number;
    });

    return allIssues;
  }

  /**
   * List all tasks for the board view (kanban)
   */
  async listAllTasksForBoard(projectFilter?: string): Promise<BoardTasksResult> {
    let projects = await this.projectsResolver.getAllProjects();

    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    // Get worker assignments
    const workerAssignments = this.getWorkerAssignments();

    const issuesWithTasks: IssueWithTasks[] = [];
    const completedTasks: CompletedTaskWithContext[] = [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffDateStr = cutoffDate.toISOString();

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const boardService = new BoardQueryService(db);
        const boardData = boardService.getActiveIssuesWithTasks();

        for (const { issue, plan, tasks, milestone } of boardData) {
          // Enrich tasks with worker info
          const tasksWithWorker: TaskWithWorker[] = tasks.map((task) => {
            const workerInfo = workerAssignments.get(task.id);
            if (workerInfo) {
              return {
                ...task,
                workerId: workerInfo.workerId,
                workerName: workerInfo.workerName ?? undefined,
              };
            }
            return task;
          });

          issuesWithTasks.push({
            issue,
            plan,
            tasks: tasksWithWorker,
            milestoneNumber: milestone?.number,
            milestoneTitle: milestone?.title,
            projectName: project.name,
            projectSlug: project.slug,
          });

          // Collect completed tasks from last 7 days
          for (const task of tasks) {
            if (task.status !== "COMPLETED" && task.status !== "ABANDONED") continue;

            const completionDate = task.completedAt ?? task.abandonedAt;
            if (!completionDate || completionDate < cutoffDateStr) continue;

            completedTasks.push({
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
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort completed tasks by completion date descending
    completedTasks.sort((a, b) => {
      const dateA = a.completedAt ?? a.abandonedAt ?? "";
      const dateB = b.completedAt ?? b.abandonedAt ?? "";
      return dateB.localeCompare(dateA);
    });

    return {
      issuesWithTasks,
      completedTasks: completedTasks.slice(0, 20),
    };
  }

  /**
   * List all milestones across projects
   */
  async listAllMilestones(projectFilter?: string): Promise<MilestoneWithProject[]> {
    let projects = await this.projectsResolver.getAllProjects();

    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    const allMilestones: MilestoneWithProject[] = [];

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const milestones = db.milestones.findMany();

        for (const milestone of milestones) {
          allMilestones.push({
            ...milestone,
            projectSlug: project.slug,
            projectName: project.name,
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    return allMilestones;
  }

  /**
   * List all workers with their current tasks
   */
  listAllWorkers(): WorkerInfo[] {
    let workerQueueDb: GlobalDbWorkerQueueDb | null = null;

    try {
      workerQueueDb = new GlobalDbWorkerQueueDb();
      const entries = workerQueueDb.findAllEntriesWithHealth();

      return entries
        .filter((e) => e.workerId && e.status === "WORKING")
        .map((e) => ({
          workerId: e.workerId!,
          workerName: e.workerName ?? null,
          taskId: e.taskId,
          status: e.status,
          isStale: e.isStale,
        }));
    } catch {
      return [];
    } finally {
      workerQueueDb?.close();
    }
  }

  /**
   * List all git worktrees
   */
  async listAllWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const worktreeService = new NodeGitWorktreeService(process.cwd());
      return await worktreeService.listWorktrees();
    } catch {
      return [];
    }
  }

  /**
   * Get worker data including enriched queue entries and worker details
   */
  async getWorkerData(): Promise<WorkerDataResult> {
    const workerQueueDb = new GlobalDbWorkerQueueDb();
    try {
      // Get workers and queue from the worker queue database
      const workers = workerQueueDb.findAllWorkersWithHealth();
      const queueEntries = workerQueueDb.findAllEntriesWithHealth();
      const stats = workerQueueDb.getQueueStats();

      // Try to get project info for enrichment, but don't fail if unavailable
      let projects: { projectId: string; slug: string }[] = [];
      try {
        const sources = await this.projectsResolver.getAllSources();
        projects = sources.flatMap((s) => s.projects);
      } catch {
        // Projects unavailable, continue without enrichment
      }

      // Enrich queue entries with task details
      const enrichedQueue: DispatchQueueEntryWithDetails[] = [];
      for (const entry of queueEntries) {
        const details =
          projects.length > 0 ? await this.lookupTaskDetails(entry.taskId, projects) : null;
        enrichedQueue.push({
          ...entry,
          taskNumber: details?.taskNumber,
          issueNumber: details?.issueNumber,
          taskTitle: details?.taskTitle,
          totalTasks: details?.totalTasks,
        });
      }

      // Enrich workers with task details
      const enrichedWorkers: WorkerWithTaskDetails[] = [];
      for (const worker of workers) {
        if (worker.currentTaskId && projects.length > 0) {
          const details = await this.lookupTaskDetails(worker.currentTaskId, projects);
          enrichedWorkers.push({
            ...worker,
            taskNumber: details?.taskNumber,
            issueNumber: details?.issueNumber,
            taskStartedAt: details?.taskStartedAt ?? undefined,
            totalTasks: details?.totalTasks,
          });
        } else {
          enrichedWorkers.push(worker);
        }
      }

      return {
        workers: enrichedWorkers,
        queue: enrichedQueue,
        stats,
      };
    } finally {
      workerQueueDb.close();
    }
  }

  /**
   * Get worktrees with task information enrichment
   */
  async getWorktreesWithTaskInfo(projectFilter?: string): Promise<ProjectWorktree[]> {
    let projects = await this.projectsResolver.getAllProjects();

    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    const allWorktrees: ProjectWorktree[] = [];

    for (const project of projects) {
      try {
        const config = await resolveConfig(project.slug);
        if (!config.gitRoot) continue;

        const db = await this.getDbClient(project);
        const worktreeService = new NodeGitWorktreeService(config.gitRoot);
        const worktrees = await worktreeService.listWorktrees();

        // Build task lookup by worktree path
        const tasksByWorktreePath = new Map<string, { task: Task; issueNumber: number }>();
        const issues = db.issues.findMany({});

        for (const issue of issues) {
          const plan = db.plans.findByIssueId(issue.id);
          if (!plan) continue;

          const tasks = db.tasks.findByPlanId(plan.id);
          for (const task of tasks) {
            if (task.worktreePath) {
              tasksByWorktreePath.set(task.worktreePath, { task, issueNumber: issue.number });
            }
          }
        }

        for (const wt of worktrees) {
          if (wt.isMain) continue;

          const taskInfo = tasksByWorktreePath.get(wt.path);
          allWorktrees.push({
            projectId: project.projectId,
            path: wt.path,
            branch: wt.branch,
            head: wt.head,
            isMain: wt.isMain,
            diskUsageBytes: wt.diskUsageBytes,
            taskId: taskInfo?.task?.id,
            taskNumber: taskInfo?.task?.number,
            taskTitle: taskInfo?.task?.title,
            taskStatus: taskInfo?.task?.status,
            issueNumber: taskInfo?.issueNumber,
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    return allWorktrees;
  }

  /**
   * Prune stale worktrees for a project
   */
  async pruneWorktrees(projectId: string): Promise<PruneWorktreesResult> {
    const allProjects = await this.projectsResolver.getAllProjects();
    const project = allProjects.find((p) => p.projectId === projectId);

    if (!project) {
      throw new EntityNotFoundError("Project", projectId);
    }

    const config = await resolveConfig(project.slug);
    if (!config.gitRoot) {
      throw new Error(
        "Project config.json not found. Run 'dev-workflow init' in the project directory first."
      );
    }

    const worktreeService = new NodeGitWorktreeService(config.gitRoot);

    const beforeCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;
    await worktreeService.pruneWorktrees();
    const afterCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

    return { success: true, pruned: beforeCount - afterCount };
  }

  /**
   * Get milestones with issue details and progress
   */
  async getMilestonesWithDetails(
    projectFilter?: string,
    sourceFilter?: string
  ): Promise<MilestoneWithDetails[]> {
    let projects = await this.projectsResolver.getAllProjects();

    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }
    if (sourceFilter) {
      projects = projects.filter((p) => p.slug === sourceFilter);
    }

    const result: MilestoneWithDetails[] = [];

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const milestones = db.milestones.findMany();
        const statusService = new IssueStatusService(db);

        for (const milestone of milestones) {
          const issues = db.issues.findMany({ milestoneId: milestone.id });
          const closedIssues = issues.filter(isIssueClosed).length;

          const milestoneIssueStats: MilestoneIssueStats = {
            totalIssues: issues.length,
            closedIssues,
            openOrInProgressIssues: issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i))
              .length,
          };

          const computedMilestoneStatus = computeMilestoneStatus(
            milestone.status,
            milestoneIssueStats,
            milestone.endDate
          );

          const issuesWithStatus = issues.map((issue) => {
            const { computedStatus } = statusService.computeStatus(issue);
            return {
              number: issue.number,
              title: issue.title,
              status: issue.status,
              computedStatus,
              type: issue.type,
            };
          });

          result.push({
            milestone: {
              ...milestone,
              status: computedMilestoneStatus,
              projectName: project.name,
              projectSlug: project.slug,
            },
            issues: issuesWithStatus,
            progress: {
              total: issues.length,
              closed: closedIssues,
              percentage: issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
            },
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort by start date
    result.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));

    return result;
  }

  /**
   * Get task dependencies by task ID (searches across all projects)
   */
  async getTaskDependencies(taskId: string): Promise<TaskDependencyWithIssue[]> {
    const projects = await this.projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const task = db.tasks.findById(taskId);

        if (task) {
          if (!task.dependsOn || task.dependsOn.length === 0) {
            return [];
          }
          const dependencies = db.tasks.findByIds(task.dependsOn);
          return dependencies.map((dep) => {
            const depPlan = db.plans.findById(dep.planId);
            const depIssue = depPlan ? db.issues.findById(depPlan.issueId) : null;
            return {
              ...dep,
              issueNumber: depIssue?.number ?? null,
            };
          });
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", taskId);
  }

  /**
   * Get task status history by task ID (searches across all projects)
   */
  async getTaskStatusHistory(taskId: string): Promise<unknown[]> {
    const projects = await this.projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const task = db.tasks.findById(taskId);

        if (task) {
          return db.tasks.getStatusHistory(taskId);
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", taskId);
  }

  /**
   * Get task execution logs by task ID (searches across all projects)
   */
  async getTaskExecutionLogs(taskId: string): Promise<unknown[]> {
    const projects = await this.projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = await this.getDbClient(project);
        const task = db.tasks.findById(taskId);

        if (task) {
          return db.executionLogs.findByTaskId(taskId);
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", taskId);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async getDbClient(project: ProjectInfo): Promise<DbClient> {
    const source = this.sourceProvider.getOrCreate(project.sourceInfo);
    await source.provision();
    return source.createClient(project.projectId);
  }

  private getWorkerAssignments(): Map<string, WorkerTaskAssignment> {
    const assignments = new Map<string, WorkerTaskAssignment>();
    let workerQueueDb: GlobalDbWorkerQueueDb | null = null;

    try {
      workerQueueDb = new GlobalDbWorkerQueueDb();
      const entries = workerQueueDb.findAllEntriesWithHealth();

      for (const entry of entries) {
        if (entry.workerId && entry.status === "WORKING") {
          assignments.set(entry.taskId, {
            taskId: entry.taskId,
            workerId: entry.workerId,
            workerName: entry.workerName ?? null,
          });
        }
      }

      return assignments;
    } catch {
      return assignments;
    } finally {
      workerQueueDb?.close();
    }
  }

  private async lookupTaskDetails(
    taskId: string,
    projects: { projectId: string; slug: string }[]
  ): Promise<TaskDetails | null> {
    for (const project of projects) {
      try {
        const projectInfo = await this.projectsResolver.getProjectBySlug(project.slug);
        const db = await this.getDbClient(projectInfo);
        const task = db.tasks.findById(taskId);

        if (task) {
          const plan = db.plans.findById(task.planId);
          if (plan) {
            const issue = db.issues.findById(plan.issueId);
            if (issue) {
              const allTasks = db.tasks.findByPlanId(plan.id);
              return {
                taskNumber: task.number,
                issueNumber: issue.number,
                taskTitle: task.title,
                taskStartedAt: task.startedAt ?? null,
                totalTasks: allTasks.length,
              };
            }
          }
        }
      } catch {
        // Continue searching
      }
    }
    return null;
  }
}

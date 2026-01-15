/**
 * TaskAppService - Application service for task operations in web context
 *
 * This service handles project resolution and delegates to core TaskService.
 * Endpoints call this service with projectSlug + taskId, and the service
 * handles all the complexity of resolving the project and creating services.
 */

import {
  ProjectsResolver,
  DbSourceProvider,
  TaskService,
  IssueService,
  DependencyService,
  NoOpProjectManagementProvider,
  EntityNotFoundError,
  BusinessRuleError,
  isValidStatusTransition,
  isIssueInPlanning,
  isTerminal,
  type Task,
  type TaskStatus,
  type AbandonTaskResult,
  type DbClient,
  type TaskStatusHistory,
  type ExecutionLog,
} from "@dev-workflow/core";

/**
 * Task dependency with blocking status
 */
export interface TaskDependencyInfo {
  task: Task;
  isBlocking: boolean;
}

/**
 * Result of transitioning a task status
 */
export interface TransitionTaskResult {
  task: Task;
  previousStatus: string;
}

/**
 * Result of abandoning a task with cleanup info
 */
export interface AbandonTaskWithCleanupResult {
  task: Task;
  previousStatus: string;
  cleanup: {
    externalIssueClosed: boolean;
    worktreeCleaned: boolean;
    branchDeleted: boolean;
  };
}

/**
 * TaskAppService - Handles task operations with project resolution
 */
export class TaskAppService {
  constructor(
    private readonly projectsResolver: ProjectsResolver,
    private readonly sourceProvider: DbSourceProvider
  ) {}

  /**
   * Transition a task to a new status with full validation
   */
  async transitionTask(
    projectSlug: string,
    taskId: string,
    toStatus: TaskStatus,
    actor = "web-ui"
  ): Promise<TransitionTaskResult> {
    const db = await this.getDbClient(projectSlug);
    const taskService = this.createTaskService(db);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    const previousStatus = task.status;

    // Validate the transition is allowed
    if (!isValidStatusTransition(task.status, toStatus)) {
      throw new BusinessRuleError(`Invalid transition from ${task.status} to ${toStatus}`);
    }

    // Special handling for IN_PROGRESS → PR_REVIEW: require PR exists
    if (task.status === "IN_PROGRESS" && toStatus === "PR_REVIEW") {
      if (!task.prUrl) {
        throw new BusinessRuleError(
          "Cannot submit for review without a PR. Create a PR first using the CLI."
        );
      }
    }

    // For PLANNED → BACKLOG, also transition the parent issue from PLANNED to OPEN
    if (task.status === "PLANNED" && toStatus === "BACKLOG") {
      const plan = db.plans.findById(task.planId);
      if (plan) {
        const issue = db.issues.findById(plan.issueId);
        if (issue && isIssueInPlanning(issue)) {
          const issueService = this.createIssueService(db, taskService);
          issueService.update(issue.id, { status: "OPEN" });
        }
      }
    }

    // Update task status
    const updatedTask = await taskService.updateStatus(
      taskId,
      toStatus,
      actor,
      `Status changed via kanban board: ${previousStatus} → ${toStatus}`
    );

    return { task: updatedTask, previousStatus };
  }

  /**
   * Abandon a task with full cleanup
   */
  async abandonTaskWithCleanup(
    projectSlug: string,
    taskId: string,
    reason?: string,
    actor = "web-ui"
  ): Promise<AbandonTaskWithCleanupResult> {
    const db = await this.getDbClient(projectSlug);
    const taskService = this.createTaskService(db);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    // Check if already terminal
    if (isTerminal(task)) {
      throw new BusinessRuleError(`Task is already in terminal state: ${task.status}`);
    }

    const previousStatus = task.status;

    const result = await taskService.abandonTask(taskId, reason ?? "User abandoned via UI", actor);

    return {
      task: result.task,
      previousStatus,
      cleanup: {
        externalIssueClosed: result.externalIssueClosed,
        worktreeCleaned: result.worktreeCleaned,
        branchDeleted: result.branchDeleted,
      },
    };
  }

  /**
   * Abandon a task (simpler version without cleanup info)
   */
  async abandonTask(
    projectSlug: string,
    taskId: string,
    reason: string,
    actor = "web-ui"
  ): Promise<AbandonTaskResult> {
    const db = await this.getDbClient(projectSlug);
    const taskService = this.createTaskService(db);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    return taskService.abandonTask(taskId, reason, actor);
  }

  /**
   * Get task dependencies
   */
  async getTaskDependencies(projectSlug: string, taskId: string): Promise<TaskDependencyInfo[]> {
    const db = await this.getDbClient(projectSlug);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    // Get all dependency tasks
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return [];
    }

    const depService = new DependencyService(db);
    const blockingDeps = depService.getBlockingDependencies(task);
    const blockingIds = new Set(blockingDeps.map((d) => d.id));

    // Get all dependency tasks
    const allDeps = db.tasks.findByIds(task.dependsOn);

    return allDeps.map((dep) => ({
      task: dep,
      isBlocking: blockingIds.has(dep.id),
    }));
  }

  /**
   * Get task status history
   */
  async getTaskStatusHistory(projectSlug: string, taskId: string): Promise<TaskStatusHistory[]> {
    const db = await this.getDbClient(projectSlug);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    return db.tasks.getStatusHistory(taskId);
  }

  /**
   * Get task execution logs
   */
  async getTaskExecutionLogs(projectSlug: string, taskId: string): Promise<ExecutionLog[]> {
    const db = await this.getDbClient(projectSlug);

    const task = db.tasks.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    return db.executionLogs.findByTaskId(taskId);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async getDbClient(projectSlug: string): Promise<DbClient> {
    const projectInfo = await this.projectsResolver.getProjectBySlug(projectSlug);
    const source = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
    await source.provision();
    return source.createClient(projectInfo.projectId);
  }

  private createTaskService(db: DbClient): TaskService {
    const noOpProvider = new NoOpProjectManagementProvider();
    return new TaskService(db, noOpProvider, null);
  }

  private createIssueService(db: DbClient, taskService: TaskService): IssueService {
    const noOpProvider = new NoOpProjectManagementProvider();
    return new IssueService(db, taskService, noOpProvider);
  }
}

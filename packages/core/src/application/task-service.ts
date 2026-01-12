/**
 * TaskService - Application service for task operations
 *
 * Orchestrates task operations including status transitions, external sync,
 * and worktree cleanup. All task mutations should go through this service
 * to ensure consistent behavior across MCP tools, web API, and CLI.
 *
 * Follows Service Layer Pattern:
 * - Orchestrates multi-step operations
 * - Uses repositories for data access
 * - Syncs with external provider (ProjectManagementProvider)
 */

import type { Task, TaskStatus, PRStatus, TaskRepository } from "../domain/task.js";
import type { ProjectManagementProvider } from "../domain/project-management-provider.js";
import type { GitWorktreeService } from "../infrastructure/git/git-worktree-service.js";
import type { DbClient } from "../domain/db-client.js";
import { isValidStatusTransition, getAllowedTransitions } from "../domain/task.js";

/**
 * Error thrown when task operation fails
 */
export class TaskServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_TRANSITION"
      | "ALREADY_TERMINAL"
      | "SYNC_FAILED"
      | "WORKTREE_CLEANUP_FAILED" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TaskServiceError";
  }
}

/**
 * Result of abandoning a task
 */
export interface AbandonTaskResult {
  task: Task;
  externalIssueClosed: boolean;
  worktreeCleaned: boolean;
  branchDeleted: boolean;
  removedFromQueue: boolean;
}

/**
 * TaskService - Orchestrates task operations with external provider
 */
export class TaskService {
  constructor(
    private readonly db: DbClient,
    private readonly provider: ProjectManagementProvider,
    private readonly gitWorktreeService: GitWorktreeService | null
  ) {}

  /**
   * Check if a task is in a terminal state
   */
  isTerminal(task: Task): boolean {
    return task.status === "COMPLETED" || task.status === "ABANDONED";
  }

  /**
   * Find a task by ID
   *
   * @returns Task or null if not found
   */
  findById(taskId: string): Task | null {
    return this.db.tasks.findById(taskId);
  }

  /**
   * Get a task by ID
   *
   * @throws TaskServiceError if task not found
   */
  getTask(taskId: string): Task {
    const task = this.db.tasks.findById(taskId);
    if (!task) {
      throw new TaskServiceError(`Task not found: ${taskId}`, "NOT_FOUND");
    }
    return task;
  }

  /**
   * Update task status with validation and external sync
   *
   * Validates the status transition is allowed, updates the task,
   * and syncs to external provider if available.
   *
   * For terminal states (COMPLETED, ABANDONED), closes the external issue.
   *
   * @param taskId - Task UUID
   * @param newStatus - Target status
   * @param changedBy - Who made the change
   * @param notes - Optional notes about the change
   * @returns The updated task
   * @throws TaskServiceError if transition is invalid
   */
  async updateStatus(
    taskId: string,
    newStatus: TaskStatus,
    changedBy?: string,
    notes?: string
  ): Promise<Task> {
    const task = this.getTask(taskId);

    // Validate transition
    if (!isValidStatusTransition(task.status, newStatus)) {
      const allowed = getAllowedTransitions(task.status);
      throw new TaskServiceError(
        `Invalid status transition from ${task.status} to ${newStatus}. ` +
          `Allowed transitions: ${allowed.join(", ") || "none (terminal state)"}`,
        "INVALID_TRANSITION"
      );
    }

    // Update local status first
    const updatedTask = this.db.tasks.updateStatus(taskId, newStatus, changedBy, notes);

    // Sync terminal states to external provider (provider handles sync check internally)
    if (newStatus === "COMPLETED" || newStatus === "ABANDONED") {
      await this.provider.closeIssueByTask(task);
    }

    return updatedTask;
  }

  /**
   * Abandon a task
   *
   * Transitions task to ABANDONED status, closes external issue if synced,
   * cleans up worktree and branch, and removes from dispatch queue.
   *
   * This is the canonical implementation for abandoning tasks.
   * IssueService.closeIssue calls this for incomplete tasks.
   *
   * @param taskId - Task UUID
   * @param reason - Optional reason for abandonment
   * @param changedBy - Who abandoned the task
   * @returns Result including cleanup status
   * @throws TaskServiceError if task not found or already terminal
   */
  async abandonTask(
    taskId: string,
    reason?: string,
    changedBy?: string
  ): Promise<AbandonTaskResult> {
    const task = this.getTask(taskId);

    // Check if already terminal
    if (this.isTerminal(task)) {
      throw new TaskServiceError(
        `Task ${taskId} is already in terminal state: ${task.status}`,
        "ALREADY_TERMINAL"
      );
    }

    const result: AbandonTaskResult = {
      task,
      externalIssueClosed: false,
      worktreeCleaned: false,
      branchDeleted: false,
      removedFromQueue: false,
    };

    // 1. Remove from dispatch queue if present
    if (this.db.dispatchQueue) {
      try {
        this.db.dispatchQueue.remove(taskId);
        result.removedFromQueue = true;
      } catch {
        // Queue removal is best-effort
      }
    }

    // 2. Clean up worktree and branch
    if (this.gitWorktreeService && task.worktreePath) {
      try {
        await this.gitWorktreeService.removeWorktree(task.worktreePath, true);
        result.worktreeCleaned = true;
        if (task.branchName) {
          result.branchDeleted = true;
        }
      } catch {
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }
      this.db.tasks.clearWorktreeInfo(taskId);
    } else if (this.gitWorktreeService && task.branchName) {
      try {
        await this.gitWorktreeService.run(["branch", "-D", task.branchName]);
      } catch {
        // Local branch may not exist
      }

      try {
        const checkResult = await this.gitWorktreeService.run([
          "ls-remote",
          "--heads",
          "origin",
          task.branchName,
        ]);
        if (checkResult.success && checkResult.stdout.trim()) {
          await this.gitWorktreeService.run([
            "push",
            "origin",
            "--delete",
            "--no-verify",
            task.branchName,
          ]);
          result.branchDeleted = true;
        }
      } catch {
        console.warn(`Failed to delete remote branch: ${task.branchName}`);
      }

      this.db.tasks.update(taskId, { branchName: undefined });
    }

    // 3. Close external issue (provider handles sync check internally)
    await this.provider.closeIssueByTask(task);
    result.externalIssueClosed = !!task.githubSync?.githubIssueNumber;

    // 4. Update task status to ABANDONED
    const updatedTask = this.db.tasks.updateStatus(
      taskId,
      "ABANDONED",
      changedBy ?? "system",
      reason ?? "Task abandoned"
    );

    // Clear session if present
    if (task.sessionId) {
      this.db.tasks.clearSession(taskId);
    }

    result.task = updatedTask;
    return result;
  }

  /**
   * Get all tasks for a plan
   */
  getTasksForPlan(planId: string, includeDeleted = false): Task[] {
    return this.db.tasks.findByPlanId(planId, includeDeleted);
  }

  /**
   * Get incomplete tasks for an issue
   *
   * Returns tasks that are not in terminal state (COMPLETED or ABANDONED)
   */
  getIncompleteTasksForIssue(issueId: string): Task[] {
    const plan = this.db.plans.findByIssueId(issueId);
    if (!plan) {
      return [];
    }

    return this.db.tasks.findByPlanId(plan.id).filter((t) => !t.isDeleted && !this.isTerminal(t));
  }

  /**
   * Check if all tasks for an issue are complete
   */
  areAllTasksComplete(issueId: string): boolean {
    const plan = this.db.plans.findByIssueId(issueId);
    if (!plan) {
      return true;
    }

    const tasks = this.db.tasks.findByPlanId(plan.id).filter((t) => !t.isDeleted);
    return tasks.every((t) => this.isTerminal(t));
  }

  // ============================================================================
  // Additional Read Operations (delegating to repository)
  // ============================================================================

  /**
   * Find tasks by plan ID
   */
  findByPlanId(planId: string, includeDeleted = false): Task[] {
    return this.db.tasks.findByPlanId(planId, includeDeleted);
  }

  /**
   * Find tasks by multiple IDs
   */
  findByIds(taskIds: string[]): Task[] {
    return this.db.tasks.findByIds(taskIds);
  }

  /**
   * Find many tasks with optional filtering
   */
  findMany(options: Parameters<TaskRepository["findMany"]>[0]): Task[] {
    return this.db.tasks.findMany(options);
  }

  // ============================================================================
  // Additional Write Operations (delegating to repository)
  // ============================================================================

  /**
   * Update a task
   */
  update(taskId: string, updates: Parameters<TaskRepository["update"]>[1]): Task {
    return this.db.tasks.update(taskId, updates);
  }

  /**
   * Soft delete a task
   */
  softDelete(taskId: string, deletedBy?: string): Task {
    return this.db.tasks.softDelete(taskId, deletedBy);
  }

  /**
   * Clear session from a task
   */
  clearSession(taskId: string): void {
    this.db.tasks.clearSession(taskId);
  }

  /**
   * Clear worktree info from a task
   */
  clearWorktreeInfo(taskId: string): void {
    this.db.tasks.clearWorktreeInfo(taskId);
  }

  /**
   * Update PR status
   */
  updatePRStatus(taskId: string, prStatus: PRStatus): void {
    this.db.tasks.updatePRStatus(taskId, prStatus);
  }

  /**
   * Update PR info
   */
  updatePRInfo(taskId: string, prUrl: string, prNumber: number, prStatus: PRStatus): void {
    this.db.tasks.updatePRInfo(taskId, prUrl, prNumber, prStatus);
  }

  /**
   * Update task status (direct, without validation - for internal use)
   * For external use with validation, use the async updateStatus method.
   */
  updateTaskStatus(taskId: string, status: TaskStatus, changedBy?: string, notes?: string): Task {
    return this.db.tasks.updateStatus(taskId, status, changedBy, notes);
  }

  /**
   * Get count of tasks by status
   */
  getStatusCounts(): Record<string, number> {
    return this.db.tasks.getStatusCounts();
  }
}

/**
 * TaskService - Application service for task operations
 *
 * Orchestrates task operations including status transitions, external sync,
 * GitHub issue creation, and worktree cleanup. All task mutations should go
 * through this service to ensure consistent behavior across MCP tools, web API, and CLI.
 *
 * Follows Service Layer Pattern:
 * - Orchestrates multi-step operations
 * - Uses repositories for data access
 * - Syncs with external provider (ProjectManagementProvider)
 *
 * Business Operations:
 * - moveToBacklog(): PLANNED/READY → BACKLOG
 * - moveToReady(): BACKLOG → READY
 * - start(): BACKLOG/READY → IN_PROGRESS (assigns GitHub issue)
 * - submitForReview(): IN_PROGRESS → PR_REVIEW
 * - complete(): IN_PROGRESS/PR_REVIEW → COMPLETED (closes GitHub issue)
 * - abandonTask(): Any → ABANDONED (closes GitHub issue, cleans worktree)
 *
 * GitHub Sync Operations:
 * - activatePlannedTasks(): Creates GitHub issues and moves PLANNED → BACKLOG
 * - repairIssue(): Repairs GitHub sync state for all tasks in an issue
 * - createGitHubIssueForTask(): Creates a GitHub issue for a single task
 */

import type { Task, TaskStatus, PRStatus, TaskRepository } from "./task.js";
import type { Issue } from "../issues/issue.js";
import type { SyncState } from "../../project-sync/project-management-provider.js";
import type { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { DbClient } from "../../data-access/db-client.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import type { TemplateService } from "../../templates/template-service.js";
import type { TypeService } from "../types/type-service.js";
import type { ProjectManagementService } from "../../project-sync/project-management-service.js";
// Free functions isWorkable/isActive are deprecated - using Task class methods instead
import { Effect, Service } from "@dev-workflow/effect";

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
      | "NOT_IN_BACKLOG"
      | "NOT_IN_READY"
      | "NOT_STARTED"
      | "NOT_IN_PROGRESS"
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
 * Result of activating a single task
 */
export interface TaskActivationResult {
  taskId: string;
  taskNumber: number;
  success: boolean;
  githubIssueNumber?: number;
  githubUrl?: string;
  error?: string;
}

/**
 * Result of the full task activation operation
 */
export interface ActivationResult {
  success: boolean;
  tasksActivated: TaskActivationResult[];
  issueTransitioned: boolean;
  error?: string;
}

/**
 * Result for a single task repair operation
 */
export interface TaskRepairResult {
  taskId: string;
  taskNumber: number;
  action: "created" | "linked" | "verified" | "skipped";
  githubIssueNumber?: number;
  githubUrl?: string;
  error?: string;
}

/**
 * Result of the repair_issue operation
 */
export interface IssueRepairResult {
  success: boolean;
  issueNumber: number;
  tasksProcessed: number;
  created: TaskRepairResult[];
  linked: TaskRepairResult[];
  verified: TaskRepairResult[];
  skipped: TaskRepairResult[];
  errors: TaskRepairResult[];
}

/**
 * TaskService - Orchestrates task operations with external project management
 */
export class TaskService extends Service<TaskService>()("taskService") {
  constructor(
    private readonly db: DbClient,
    private readonly projectManagement: ProjectManagementService,
    private readonly gitWorktreeService: GitWorktreeService | null,
    private readonly workerQueueDb?: WorkerQueueDb,
    private readonly templateService?: TemplateService,
    private readonly typeService?: TypeService
  ) {
    super();
  }

  /**
   * Check if a task is in a terminal state
   */
  isTerminal(task: Task): boolean {
    return task.isTerminal;
  }

  /**
   * Find a task by ID
   *
   * @returns Task or null if not found
   */
  findById(taskId: string): Effect<Task | null> {
    return this.db.tasks.findById(taskId);
  }

  /**
   * Get a task by ID
   *
   * @throws TaskServiceError if task not found
   */
  getTask(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task) {
        throw new TaskServiceError(`Task not found: ${taskId}`, "NOT_FOUND");
      }
      return task;
    });
  }

  // ============================================================================
  // Business Operations - Use these instead of generic status updates
  // ============================================================================

  /**
   * Move task to backlog
   *
   * Valid transitions:
   * - PLANNED → BACKLOG (when issue is activated)
   * - READY → BACKLOG (when deprioritizing a ready task)
   *
   * Syncs to GitHub Project column if task has sync state.
   *
   * @param taskId - Task UUID
   * @param changedBy - Who made the change
   * @returns The updated task
   * @throws TaskServiceError if task is not in PLANNED or READY status
   */
  moveToBacklog(taskId: string, changedBy?: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.getTask(taskId);

      const check = task.checkTransition("BACKLOG");
      if (!check.allowed) {
        throw new TaskServiceError(check.reason!, "INVALID_TRANSITION");
      }

      // Update local status
      const updatedTask = yield* self.db.tasks.updateStatus(
        taskId,
        "BACKLOG",
        changedBy,
        `Moved to backlog from ${task.status}`
      );

      // Sync to external provider - move to Backlog column
      yield* self.syncStatusToProvider(task, "BACKLOG");

      return updatedTask;
    });
  }

  /**
   * Move task to ready
   *
   * Valid transition: BACKLOG → READY
   *
   * Marks the task as ready to be worked on. Use this to prioritize
   * tasks that should be picked up next.
   *
   * Syncs to GitHub Project column if task has sync state.
   *
   * @param taskId - Task UUID
   * @param changedBy - Who made the change
   * @returns The updated task
   * @throws TaskServiceError if task is not in BACKLOG status
   */
  moveToReady(taskId: string, changedBy?: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.getTask(taskId);

      const check = task.checkTransition("READY");
      if (!check.allowed) {
        throw new TaskServiceError(check.reason!, "NOT_IN_BACKLOG");
      }

      // Update local status
      const updatedTask = yield* self.db.tasks.updateStatus(
        taskId,
        "READY",
        changedBy,
        "Moved to ready"
      );

      // Sync to external provider - move to Ready column
      yield* self.syncStatusToProvider(task, "READY");

      return updatedTask;
    });
  }

  /**
   * Start working on a task
   *
   * Valid transitions: BACKLOG/READY → IN_PROGRESS
   *
   * Marks the task as actively being worked on. If the task has
   * a GitHub issue, assigns it to the configured user.
   *
   * @param taskId - Task UUID
   * @param changedBy - Who started working on the task
   * @returns The updated task
   * @throws TaskServiceError if task is not in BACKLOG or READY status
   */
  start(taskId: string, changedBy?: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.getTask(taskId);

      const check = task.checkTransition("IN_PROGRESS");
      if (!check.allowed) {
        throw new TaskServiceError(check.reason!, "INVALID_TRANSITION");
      }

      // Update local status
      const updatedTask = yield* self.db.tasks.updateStatus(
        taskId,
        "IN_PROGRESS",
        changedBy,
        "Task started"
      );

      // Sync to external provider - move to In Progress column
      yield* self.syncStatusToProvider(task, "IN_PROGRESS");

      // Assign GitHub issue to configured user (best-effort)
      yield* self.assignExternalIssue(task);

      return updatedTask;
    });
  }

  /**
   * Submit task for review
   *
   * Valid transition: IN_PROGRESS → PR_REVIEW
   *
   * Marks the task as ready for code review. Typically called after
   * a PR has been created for the task.
   *
   * @param taskId - Task UUID
   * @param options - Optional settings
   * @param options.changedBy - Who submitted the task for review
   * @param options.force - Skip status validation (for recovery scenarios)
   * @returns The updated task
   * @throws TaskServiceError if task is not in IN_PROGRESS status (unless force=true)
   */
  submitForReview(taskId: string, options?: { changedBy?: string; force?: boolean }): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const { changedBy, force = false } = options ?? {};
      const task = yield* self.getTask(taskId);

      if (!force) {
        const check = task.checkTransition("PR_REVIEW");
        if (!check.allowed) {
          throw new TaskServiceError(check.reason!, "NOT_IN_PROGRESS");
        }
      }

      // Update local status
      const updatedTask = yield* self.db.tasks.updateStatus(
        taskId,
        "PR_REVIEW",
        changedBy,
        "Submitted for review"
      );

      // Sync to external provider - move to PR Review column
      yield* self.syncStatusToProvider(task, "PR_REVIEW");

      return updatedTask;
    });
  }

  /**
   * Complete a task
   *
   * Valid transitions: IN_PROGRESS/PR_REVIEW → COMPLETED
   *
   * Marks the task as complete. If the task has a GitHub issue,
   * closes it on GitHub.
   *
   * @param taskId - Task UUID
   * @param options - Optional settings
   * @param options.changedBy - Who completed the task
   * @param options.notes - Optional notes about the completion
   * @param options.force - Skip status validation (for recovery scenarios)
   * @returns The updated task
   * @throws TaskServiceError if task is not in IN_PROGRESS or PR_REVIEW status (unless force=true)
   */
  complete(
    taskId: string,
    options?: { changedBy?: string; notes?: string; force?: boolean }
  ): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const { changedBy, notes = "Task completed", force = false } = options ?? {};
      const task = yield* self.getTask(taskId);

      if (!force) {
        const check = task.checkTransition("COMPLETED");
        if (!check.allowed) {
          throw new TaskServiceError(check.reason!, "NOT_STARTED");
        }
      }

      // Update local status
      const updatedTask = yield* self.db.tasks.updateStatus(taskId, "COMPLETED", changedBy, notes);

      // Sync to external provider - close issue and move to Done column
      const closeSyncState = yield* self.projectManagement.closeIssue(task.syncState);
      if (closeSyncState) {
        yield* self.db.tasks.updateSyncState(task.id, closeSyncState);
      }
      yield* self.syncStatusToProvider(task, "COMPLETED");

      return updatedTask;
    });
  }

  // ============================================================================
  // Private Helpers - GitHub Sync
  // ============================================================================

  /**
   * Sync task status change to external project board column
   *
   * Delegates to ProjectManagementService which handles:
   * - Null checks on sync state
   * - Column name lookup
   * - API call
   * - Timestamp/error state updates
   *
   * @param task - The task being updated
   * @param newStatus - The new status
   */
  private syncStatusToProvider(task: Task, newStatus: TaskStatus): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const updatedSyncState = yield* self.projectManagement.syncTaskStatus(
        task.syncState,
        newStatus
      );
      if (updatedSyncState) {
        yield* self.db.tasks.updateSyncState(task.id, updatedSyncState);
      }
    });
  }

  /**
   * Auto-assign external issue to configured user
   *
   * Called when a task transitions to IN_PROGRESS. Delegates to
   * ProjectManagementService which handles null checks and errors.
   *
   * @param task - The task being started
   */
  private assignExternalIssue(task: Task): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const updatedSyncState = yield* self.projectManagement.autoAssign(task.syncState);
      if (updatedSyncState) {
        yield* self.db.tasks.updateSyncState(task.id, updatedSyncState);
      }
    });
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
  abandonTask(taskId: string, reason?: string, changedBy?: string): Effect<AbandonTaskResult> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.getTask(taskId);

      // Check if already terminal
      if (task.isTerminal) {
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
      if (self.workerQueueDb) {
        try {
          self.workerQueueDb.remove(taskId);
          result.removedFromQueue = true;
        } catch {
          // Queue removal is best-effort
        }
      }

      // 2. Clean up worktree and branch
      if (self.gitWorktreeService && task.worktreePath) {
        const removeResult = yield* Effect.catchAll(
          Effect.map(self.gitWorktreeService.removeWorktree(task.worktreePath, true), () => true),
          () => {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
            return Effect.succeed(false);
          }
        );
        if (removeResult) {
          result.worktreeCleaned = true;
          if (task.branchName) {
            result.branchDeleted = true;
          }
        }
        yield* self.db.tasks.clearWorktreeInfo(taskId);
      } else if (self.gitWorktreeService && task.branchName) {
        try {
          yield* self.gitWorktreeService.run(["branch", "-D", task.branchName]);
        } catch {
          // Local branch may not exist
        }

        try {
          const checkResult = yield* self.gitWorktreeService.run([
            "ls-remote",
            "--heads",
            "origin",
            task.branchName,
          ]);
          if (checkResult.success && checkResult.stdout.trim()) {
            yield* self.gitWorktreeService.run([
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

        yield* self.db.tasks.update(taskId, { branchName: undefined });
      }

      // 3. Close external issue
      const closeSyncState = yield* self.projectManagement.closeIssue(task.syncState);
      if (closeSyncState) {
        yield* self.db.tasks.updateSyncState(task.id, closeSyncState);
      }
      result.externalIssueClosed = !!task.syncState?.externalId;

      // 4. Update task status to ABANDONED
      const updatedTask = yield* self.db.tasks.updateStatus(
        taskId,
        "ABANDONED",
        changedBy ?? "system",
        reason ?? "Task abandoned"
      );

      // Clear session if present
      if (task.sessionId) {
        yield* self.db.tasks.clearSession(taskId);
      }

      result.task = updatedTask;
      return result;
    });
  }

  /**
   * Get all tasks for a plan
   */
  getTasksForPlan(planId: string, includeDeleted = false): Effect<Task[]> {
    return this.db.tasks.findByPlanId(planId, includeDeleted);
  }

  /**
   * Get incomplete tasks for an issue
   *
   * Returns tasks that are not in terminal state (COMPLETED or ABANDONED)
   */
  getIncompleteTasksForIssue(issueId: string): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const plan = yield* self.db.plans.findByIssueId(issueId);
      if (!plan) {
        return [];
      }

      const tasks = yield* self.db.tasks.findByPlanId(plan.id);
      return tasks.filter((t) => !t.isDeleted && !t.isTerminal);
    });
  }

  /**
   * Check if all tasks for an issue are complete
   */
  areAllTasksComplete(issueId: string): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const plan = yield* self.db.plans.findByIssueId(issueId);
      if (!plan) {
        return true;
      }

      const allTasks = yield* self.db.tasks.findByPlanId(plan.id);
      const tasks = allTasks.filter((t) => !t.isDeleted);
      return tasks.every((t) => t.isTerminal);
    });
  }

  // ============================================================================
  // Additional Read Operations (delegating to repository)
  // ============================================================================

  /**
   * Find tasks by plan ID
   */
  findByPlanId(planId: string, includeDeleted = false): Effect<Task[]> {
    return this.db.tasks.findByPlanId(planId, includeDeleted);
  }

  /**
   * Find tasks by multiple IDs
   */
  findByIds(taskIds: string[]): Effect<Task[]> {
    return this.db.tasks.findByIds(taskIds);
  }

  /**
   * Find many tasks with optional filtering
   */
  findMany(options: Parameters<TaskRepository["findMany"]>[0]): Effect<Task[]> {
    return this.db.tasks.findMany(options);
  }

  // ============================================================================
  // Additional Write Operations (delegating to repository)
  // ============================================================================

  /**
   * Update a task
   */
  update(taskId: string, updates: Parameters<TaskRepository["update"]>[1]): Effect<Task> {
    return this.db.tasks.update(taskId, updates);
  }

  /**
   * Soft delete a task
   */
  softDelete(taskId: string, deletedBy?: string): Effect<Task> {
    return this.db.tasks.softDelete(taskId, deletedBy);
  }

  /**
   * Clear session from a task
   */
  clearSession(taskId: string): Effect<void> {
    return Effect.map(this.db.tasks.clearSession(taskId), () => undefined);
  }

  /**
   * Clear worktree info from a task
   */
  clearWorktreeInfo(taskId: string): Effect<void> {
    return Effect.map(this.db.tasks.clearWorktreeInfo(taskId), () => undefined);
  }

  /**
   * Update PR status
   */
  updatePRStatus(taskId: string, prStatus: PRStatus): Effect<void> {
    return Effect.map(this.db.tasks.updatePRStatus(taskId, prStatus), () => undefined);
  }

  /**
   * Update PR info
   */
  updatePRInfo(taskId: string, prUrl: string, prNumber: number, prStatus: PRStatus): Effect<void> {
    return Effect.map(
      this.db.tasks.updatePRInfo(taskId, prUrl, prNumber, prStatus),
      () => undefined
    );
  }

  /**
   * Get count of tasks by status
   */
  getStatusCounts(): Effect<Record<string, number>> {
    return this.db.tasks.getStatusCounts();
  }

  // ============================================================================
  // GitHub Sync Operations
  // ============================================================================

  /**
   * Check if external sync is currently enabled
   */
  isSyncEnabled(): boolean {
    return this.projectManagement.isEnabled();
  }

  /**
   * Sync a task status change to external provider
   *
   * Called after a task status is updated to keep external system in sync.
   * - Moves the project item to the appropriate column
   * - Closes the external issue if task is COMPLETED or ABANDONED
   *
   * This is a convenience method for callers that only have a taskId.
   * The business methods (moveToReady, start, etc.) call the private
   * syncStatusToProvider directly with the task object.
   *
   * @param taskId - The task UUID
   * @param newStatus - The new status that was just set
   */
  syncTaskStatus(taskId: string, newStatus: TaskStatus): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task?.syncState?.externalId) {
        return;
      }

      // Handle terminal states - close the external issue
      if (newStatus === "COMPLETED" || newStatus === "ABANDONED") {
        const closeSyncState = yield* self.projectManagement.closeIssue(task.syncState);
        if (closeSyncState) {
          yield* self.db.tasks.updateSyncState(taskId, closeSyncState);
        }
      }

      // Move in project kanban
      const statusSyncState = yield* self.projectManagement.syncTaskStatus(
        task.syncState,
        newStatus
      );
      if (statusSyncState) {
        yield* self.db.tasks.updateSyncState(taskId, statusSyncState);
      }
    });
  }

  /**
   * Assign an external issue to the configured assignee
   *
   * Called when a task transitions to IN_PROGRESS. Delegates to
   * ProjectManagementService which handles null checks and errors.
   *
   * This is a convenience method for callers that only have a taskId.
   *
   * @param taskId - The task UUID
   */
  assignIssue(taskId: string): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task?.syncState?.externalId) {
        return;
      }

      const updatedSyncState = yield* self.projectManagement.autoAssign(task.syncState);
      if (updatedSyncState) {
        yield* self.db.tasks.updateSyncState(taskId, updatedSyncState);
      }
    });
  }

  /**
   * Activate all PLANNED tasks for an issue
   *
   * This is the main entry point called by move_issue_to_backlog.
   * For each PLANNED task:
   * 1. Creates a GitHub issue (if sync enabled)
   * 2. Transitions task from PLANNED → BACKLOG
   *
   * For imported issues (has sourceExternalId):
   * - 1 task: Link task directly to the parent GitHub issue (no new issue created)
   * - N tasks: Create GitHub sub-issues under the parent, link each task
   *
   * If the issue itself is PLANNED, it's transitioned to OPEN.
   *
   * Uses GitHub-first pattern: create on GitHub before updating local.
   * Fails fast: if any GitHub operation fails, entire operation fails.
   *
   * @param issueId - The dev-workflow issue ID
   * @returns Activation result with details for each task
   */
  activatePlannedTasks(issueId: string): Effect<ActivationResult> {
    const self = this;
    return Effect.gen(function* () {
      const issue = yield* self.db.issues.findById(issueId);
      if (!issue) {
        return {
          success: false,
          tasksActivated: [],
          issueTransitioned: false,
          error: `Issue not found: ${issueId}`,
        };
      }

      const plan = yield* self.db.plans.findByIssueId(issueId);
      if (!plan) {
        return {
          success: false,
          tasksActivated: [],
          issueTransitioned: false,
          error: `No plan found for issue: ${issueId}`,
        };
      }

      const allTasks = yield* self.db.tasks.findByPlanId(plan.id);
      const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

      if (plannedTasks.length === 0) {
        // No PLANNED tasks - just ensure issue is OPEN
        const issueTransitioned = issue.isInPlanning;
        if (issueTransitioned) {
          yield* self.db.issues.update(issue.id, { status: "OPEN" });
        }
        return {
          success: true,
          tasksActivated: [],
          issueTransitioned,
        };
      }

      const results: TaskActivationResult[] = [];
      const syncEnabled = self.projectManagement.isEnabled();

      // Check if this is an imported issue
      const isImportedIssue = issue.sourceExternalId !== undefined;

      // Process each PLANNED task
      for (const task of plannedTasks) {
        try {
          if (syncEnabled) {
            let syncState: SyncState;

            if (isImportedIssue) {
              // Imported issue - use special handling
              syncState = yield* self.handleImportedIssueTask(issue, task, plannedTasks.length);
            } else {
              // Normal issue - create new GitHub issue
              syncState = yield* self.createGitHubIssueForTask(issue, task);
            }

            // Update task with GitHub sync state
            yield* self.db.tasks.updateSyncState(task.id, syncState);
          }

          // Transition task from PLANNED → BACKLOG
          yield* self.db.tasks.updateStatus(
            task.id,
            "BACKLOG",
            "system",
            "Activated via move_issue_to_backlog"
          );

          const updatedTask = yield* self.db.tasks.findById(task.id);
          const externalIdNum = updatedTask?.syncState?.externalId
            ? parseInt(updatedTask.syncState.externalId, 10)
            : undefined;
          results.push({
            taskId: task.id,
            taskNumber: task.number,
            success: true,
            githubIssueNumber: syncEnabled ? externalIdNum : undefined,
            githubUrl: syncEnabled ? (updatedTask?.syncState?.externalUrl ?? undefined) : undefined,
          });
        } catch (error) {
          // Fail fast - if any task fails, entire operation fails
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new TaskServiceError(
            `Failed to activate task ${task.number}: ${errorMessage}`,
            "SYNC_FAILED",
            error
          );
        }
      }

      // Transition issue from PLANNED → OPEN
      const issueTransitioned = issue.isInPlanning;
      if (issueTransitioned) {
        yield* self.db.issues.update(issue.id, { status: "OPEN" });
      }

      return {
        success: true,
        tasksActivated: results,
        issueTransitioned,
      };
    });
  }

  /**
   * Close GitHub issues for abandoned tasks
   *
   * Called when tasks are abandoned during plan regeneration.
   *
   * @param taskIds - Array of task UUIDs that were abandoned
   */
  closeAbandonedTaskIssues(taskIds: string[]): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      for (const taskId of taskIds) {
        const task = yield* self.db.tasks.findById(taskId);
        if (task?.syncState?.externalId) {
          try {
            const updatedSyncState = yield* self.projectManagement.closeIssue(task.syncState);
            if (updatedSyncState) {
              yield* self.db.tasks.updateSyncState(taskId, updatedSyncState);
            }
          } catch (error) {
            // Log but don't fail - best effort to close abandoned issues
            console.warn(`Failed to close external issue for abandoned task ${taskId}:`, error);
          }
        }
      }
    });
  }

  /**
   * Sync GitHub issues for all tasks in an issue
   *
   * This tool repairs GitHub sync state by:
   * - Creating missing GitHub issues for tasks
   * - Linking existing GitHub issues found by title search
   * - Verifying already-linked GitHub issues still exist
   * - Ensuring GitHub Project state is correct
   *
   * Idempotent: safe to run multiple times, produces same result.
   * Non-destructive: never deletes GitHub issues.
   *
   * @param issueNumber - The dev-workflow issue number
   * @returns Sync result with details for each task
   */
  repairIssue(issueNumber: number): Effect<IssueRepairResult> {
    const self = this;
    return Effect.gen(function* () {
      const issue = yield* self.db.issues.findByNumber(issueNumber);
      if (!issue) {
        return {
          success: false,
          issueNumber,
          tasksProcessed: 0,
          created: [],
          linked: [],
          verified: [],
          skipped: [],
          errors: [
            {
              taskId: "",
              taskNumber: 0,
              action: "skipped" as const,
              error: `Issue #${issueNumber} not found`,
            },
          ],
        };
      }

      const plan = yield* self.db.plans.findByIssueId(issue.id);
      if (!plan) {
        return {
          success: false,
          issueNumber,
          tasksProcessed: 0,
          created: [],
          linked: [],
          verified: [],
          skipped: [],
          errors: [
            {
              taskId: "",
              taskNumber: 0,
              action: "skipped" as const,
              error: `No plan found for issue #${issueNumber}`,
            },
          ],
        };
      }

      const allTasks = yield* self.db.tasks.findByPlanId(plan.id);

      // Only sync non-terminal tasks (exclude PLANNED, COMPLETED, ABANDONED)
      // Workable OR active covers: BACKLOG, READY, IN_PROGRESS, PR_REVIEW
      const tasksToSync = allTasks.filter((t) => t.isWorkable || t.isActive);

      if (tasksToSync.length === 0) {
        return {
          success: true,
          issueNumber,
          tasksProcessed: 0,
          created: [],
          linked: [],
          verified: [],
          skipped: [],
          errors: [],
        };
      }

      const created: TaskRepairResult[] = [];
      const linked: TaskRepairResult[] = [];
      const verified: TaskRepairResult[] = [];
      const skipped: TaskRepairResult[] = [];
      const errors: TaskRepairResult[] = [];

      // Check if this is an imported issue
      const isImportedIssue = issue.sourceExternalId !== undefined;

      for (const task of tasksToSync) {
        try {
          const repairResult = yield* self.repairTask(
            issue,
            task,
            tasksToSync.length,
            isImportedIssue
          );

          switch (repairResult.action) {
            case "created":
              created.push(repairResult);
              break;
            case "linked":
              linked.push(repairResult);
              break;
            case "verified":
              verified.push(repairResult);
              break;
            case "skipped":
              skipped.push(repairResult);
              break;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            taskId: task.id,
            taskNumber: task.number,
            action: "skipped",
            error: errorMessage,
          });
        }
      }

      return {
        success: errors.length === 0,
        issueNumber,
        tasksProcessed: tasksToSync.length,
        created,
        linked,
        verified,
        skipped,
        errors,
      };
    });
  }

  /**
   * Create a GitHub issue for a single task
   *
   * @param issue - The parent dev-workflow issue
   * @param task - The task to create a GitHub issue for
   * @returns The GitHub sync state for the task
   */
  createGitHubIssueForTask(issue: Issue, task: Task): Effect<SyncState> {
    const self = this;
    return Effect.gen(function* () {
      if (!self.projectManagement.isEnabled()) {
        throw new TaskServiceError("GitHub sync is not enabled", "SYNC_FAILED");
      }

      // Use plain task title (no prefix) to avoid confusing teammates not using dev-workflow
      const title = task.title;

      // Build body with task description and dev-workflow reference as footer
      // Uses task template if available (based on task type)
      const body = yield* self.buildTaskBody(issue, task);

      // Build labels using task type (for GitHub label mapping)
      const labels = yield* self.buildLabels(task.type);

      // Ensure labels exist on the repo
      yield* self.projectManagement.ensureLabelsExist(labels);

      // Create on GitHub via provider
      const externalIssue = yield* self.projectManagement.createIssue({ title, body, labels });

      // Add to project if configured
      const projectId = self.projectManagement.getProjectId();
      let remoteProjectId: string | null = null;
      if (projectId && externalIssue.nodeId) {
        try {
          const result = yield* self.projectManagement.addToProject(
            externalIssue.nodeId!,
            projectId
          );

          if (!result.success || !result.itemId) {
            throw new TaskServiceError(
              result.error ?? `Project association returned empty item ID for project ${projectId}`,
              "SYNC_FAILED"
            );
          }

          remoteProjectId = result.itemId;

          // Move to Backlog column (initial status for activated tasks)
          yield* self.projectManagement.moveToColumn(remoteProjectId!, projectId, "Backlog");

          // Sync task labels to project custom fields (if mapping configured)
          const labelFieldMapping = self.projectManagement.getLabelFieldMapping();
          if (labelFieldMapping && task.labels) {
            yield* self.syncLabelsToProjectFields(
              remoteProjectId,
              projectId,
              task.labels,
              labelFieldMapping
            );
          }
        } catch (error) {
          if (error instanceof TaskServiceError) {
            throw error;
          }
          throw new TaskServiceError(
            `Failed to add task to GitHub Project ${projectId}`,
            "SYNC_FAILED",
            error
          );
        }
      }

      const syncState: SyncState = {
        externalId: externalIssue.numericId?.toString() ?? externalIssue.id,
        externalUrl: externalIssue.url,
        externalNodeId: externalIssue.nodeId ?? null,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        remoteProjectId,
      };

      return syncState;
    });
  }

  // ============================================================================
  // Private Helpers - GitHub Sync
  // ============================================================================

  /**
   * Handle task activation for imported issues
   */
  private handleImportedIssueTask(
    issue: Issue,
    task: Task,
    totalTaskCount: number
  ): Effect<SyncState> {
    const self = this;
    return Effect.gen(function* () {
      const parentIssueNumber = issue.sourceExternalId!;

      if (totalTaskCount === 1) {
        // 1 task case: Link directly to the parent GitHub issue
        return yield* self.linkTaskToParentIssue(parentIssueNumber, issue, task);
      } else {
        // N tasks case: Create a sub-issue under the parent
        return yield* self.createSubIssueForTask(parentIssueNumber, issue, task);
      }
    });
  }

  /**
   * Link a task directly to an existing GitHub issue (for 1-task imported issues)
   */
  private linkTaskToParentIssue(
    parentExternalId: string,
    _issue: Issue,
    task: Task
  ): Effect<SyncState> {
    const self = this;
    return Effect.gen(function* () {
      // Fetch the parent GitHub issue to get its nodeId and URL
      const parentIssue = yield* self.projectManagement.getIssue(parentExternalId);
      if (!parentIssue) {
        throw new TaskServiceError(
          `Parent GitHub issue #${parentExternalId} not found`,
          "SYNC_FAILED"
        );
      }

      const projectId = self.projectManagement.getProjectId();

      // Add to project if configured
      let remoteProjectId: string | null = null;
      if (projectId && parentIssue.nodeId) {
        try {
          const result = yield* self.projectManagement.addToProject(parentIssue.nodeId!, projectId);

          if (!result.success || !result.itemId) {
            throw new TaskServiceError(
              result.error ?? `Project association returned empty item ID for project ${projectId}`,
              "SYNC_FAILED"
            );
          }

          remoteProjectId = result.itemId;

          // Move to Backlog column
          yield* self.projectManagement.moveToColumn(remoteProjectId!, projectId, "Backlog");

          // Sync task labels to project custom fields (if mapping configured)
          const labelFieldMapping = self.projectManagement.getLabelFieldMapping();
          if (labelFieldMapping && task.labels) {
            yield* self.syncLabelsToProjectFields(
              remoteProjectId,
              projectId,
              task.labels,
              labelFieldMapping
            );
          }
        } catch (error) {
          if (error instanceof TaskServiceError) {
            throw error;
          }
          throw new TaskServiceError(
            `Failed to add parent issue to GitHub Project ${projectId}`,
            "SYNC_FAILED",
            error
          );
        }
      }

      return {
        externalId: parentIssue.numericId?.toString() ?? parentIssue.id,
        externalUrl: parentIssue.url,
        externalNodeId: parentIssue.nodeId ?? null,
        syncStatus: "SYNCED" as const,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        remoteProjectId,
      };
    });
  }

  /**
   * Create a GitHub sub-issue for a task (for N-tasks imported issues)
   */
  private createSubIssueForTask(
    parentExternalId: string,
    issue: Issue,
    task: Task
  ): Effect<SyncState> {
    const self = this;
    return Effect.gen(function* () {
      // Create a new GitHub issue for this task
      const syncState = yield* self.createGitHubIssueForTask(issue, task);

      // Link as sub-issue of the parent using the provider
      yield* self.projectManagement.linkIssues(parentExternalId, syncState.externalId!);

      return syncState;
    });
  }

  /**
   * Sync a single task's GitHub issue state
   */
  private repairTask(
    issue: Issue,
    task: Task,
    totalTaskCount: number,
    isImportedIssue: boolean
  ): Effect<TaskRepairResult> {
    const self = this;
    return Effect.gen(function* () {
      // Case 1: Task already has GitHub sync - verify it exists
      if (task.syncState?.externalId) {
        const existingIssue = yield* self.projectManagement.getIssue(
          String(task.syncState!.externalId)
        );

        if (existingIssue) {
          // Issue exists - verify project state and return verified
          yield* self.ensureProjectState(task);

          return {
            taskId: task.id,
            taskNumber: task.number,
            action: "verified" as const,
            githubIssueNumber: existingIssue.numericId ?? parseInt(existingIssue.id, 10),
            githubUrl: existingIssue.url,
          };
        }

        // Issue was deleted - clear sync state and proceed to create/link
        yield* self.db.tasks.updateSyncState(task.id, {
          externalId: null,
          externalUrl: null,
          externalNodeId: null,
          syncStatus: "NOT_SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: "GitHub issue was deleted, re-syncing",
          remoteProjectId: null,
        });
      }

      // Case 2: No GitHub sync - search for existing issue by title pattern
      const searchPattern = `Task ${issue.number}.${task.number}:`;
      const searchResults = yield* self.projectManagement.searchIssues(searchPattern, "all", 5);

      // Look for an exact match in the body (footer pattern)
      const matchingIssue = searchResults.find((gh) =>
        gh.body.includes(`Task ${issue.number}.${task.number}: ${task.title}`)
      );

      if (matchingIssue) {
        // Found existing issue - link it
        const syncState = yield* self.linkExistingGitHubIssue(matchingIssue, task);
        yield* self.db.tasks.updateSyncState(task.id, syncState);

        return {
          taskId: task.id,
          taskNumber: task.number,
          action: "linked" as const,
          githubIssueNumber: matchingIssue.numericId ?? parseInt(matchingIssue.id, 10),
          githubUrl: matchingIssue.url,
        };
      }

      // Case 3: No existing issue found - create new one
      let syncState: SyncState;

      if (isImportedIssue) {
        syncState = yield* self.handleImportedIssueTask(issue, task, totalTaskCount);
      } else {
        syncState = yield* self.createGitHubIssueForTask(issue, task);
      }

      yield* self.db.tasks.updateSyncState(task.id, syncState);

      // Sync to correct column based on current task status
      const updatedState = yield* self.projectManagement.syncTaskStatus(syncState, task.status);
      if (updatedState) {
        yield* self.db.tasks.updateSyncState(task.id, updatedState);
      }

      return {
        taskId: task.id,
        taskNumber: task.number,
        action: "created" as const,
        githubIssueNumber: syncState.externalId ? parseInt(syncState.externalId, 10) : undefined,
        githubUrl: syncState.externalUrl ?? undefined,
      };
    });
  }

  /**
   * Link an existing GitHub issue to a task
   */
  private linkExistingGitHubIssue(
    externalIssue: { id: string; numericId?: number; url: string; nodeId?: string },
    task: Task
  ): Effect<SyncState> {
    const self = this;
    return Effect.gen(function* () {
      // Add to project if configured
      const projectId = self.projectManagement.getProjectId();
      let remoteProjectId: string | null = null;
      if (projectId && externalIssue.nodeId) {
        try {
          const result = yield* self.projectManagement.addToProject(
            externalIssue.nodeId!,
            projectId
          );

          // Move to correct column based on task status
          if (result.success && result.itemId) {
            remoteProjectId = result.itemId;
            const columnName = self.projectManagement.getColumnForStatus(task.status);
            if (columnName) {
              yield* self.projectManagement.moveToColumn(remoteProjectId!, projectId, columnName);
            }

            // Sync task labels to project custom fields (if mapping configured)
            const labelFieldMapping = self.projectManagement.getLabelFieldMapping();
            if (labelFieldMapping && task.labels) {
              yield* self.syncLabelsToProjectFields(
                remoteProjectId,
                projectId,
                task.labels,
                labelFieldMapping
              );
            }
          }
        } catch (error) {
          // Log but don't fail - project linking is not critical
          console.warn(
            `Failed to add issue to project: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        externalId: externalIssue.numericId?.toString() ?? externalIssue.id,
        externalUrl: externalIssue.url,
        externalNodeId: externalIssue.nodeId ?? null,
        syncStatus: "SYNCED" as const,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        remoteProjectId,
      };
    });
  }

  /**
   * Ensure a task's GitHub issue is in the correct project state
   */
  private ensureProjectState(task: Task): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const projectId = self.projectManagement.getProjectId();
      if (!projectId || !task.syncState) {
        return;
      }

      // If no project item ID, try to add to project
      if (!task.syncState.remoteProjectId && task.syncState.externalNodeId) {
        try {
          const result = yield* self.projectManagement.addToProject(
            task.syncState!.externalNodeId!,
            projectId
          );

          if (result.success && result.itemId) {
            // Update task with project item ID
            const newSyncState = {
              ...task.syncState,
              remoteProjectId: result.itemId,
              lastSyncedAt: new Date().toISOString(),
            };
            yield* self.db.tasks.updateSyncState(task.id, newSyncState);

            // Move to correct column
            const updatedState = yield* self.projectManagement.syncTaskStatus(
              newSyncState,
              task.status
            );
            if (updatedState) {
              yield* self.db.tasks.updateSyncState(task.id, updatedState);
            }

            // Sync task labels to project custom fields (if mapping configured)
            const labelFieldMapping = self.projectManagement.getLabelFieldMapping();
            if (labelFieldMapping && task.labels) {
              yield* self.syncLabelsToProjectFields(
                result.itemId,
                projectId,
                task.labels,
                labelFieldMapping
              );
            }
          }
        } catch (error) {
          console.warn(
            `Failed to add to project: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } else if (task.syncState.remoteProjectId) {
        // Already has project item - ensure correct column and labels
        const updatedState = yield* self.projectManagement.syncTaskStatus(
          task.syncState,
          task.status
        );
        if (updatedState) {
          yield* self.db.tasks.updateSyncState(task.id, updatedState);
        }

        // Sync task labels to project custom fields (if mapping configured)
        const labelFieldMapping = self.projectManagement.getLabelFieldMapping();
        if (labelFieldMapping && task.labels) {
          yield* self.syncLabelsToProjectFields(
            task.syncState.remoteProjectId,
            projectId,
            task.labels,
            labelFieldMapping
          );
        }
      }
    });
  }

  /**
   * Build the GitHub issue body for a task
   */
  private buildTaskBody(issue: Issue, task: Task): Effect<string> {
    const self = this;
    return Effect.gen(function* () {
      // Try to use task template if template service is available
      if (self.templateService) {
        try {
          const template = yield* self.templateService!.getTaskTemplate(task.type);
          if (template) {
            const body = self.applyTaskPlaceholders(template.content, issue, task);
            return self.appendFooter(body, issue, task);
          }
        } catch {
          // Log but don't fail - fall back to default behavior
          console.warn(
            `Failed to load task template for type ${task.type}, falling back to default format`
          );
        }
      }

      // Fall back to hardcoded format
      return self.buildDefaultTaskBody(issue, task);
    });
  }

  /**
   * Apply placeholders to task template content
   */
  private applyTaskPlaceholders(content: string, issue: Issue, task: Task): string {
    let result = content;

    // Replace {{description}}
    result = result.replace(/\{\{description\}\}/g, task.description);

    // Replace {{acceptanceCriteria}}
    const criteriaList =
      task.acceptanceCriteria.length > 0
        ? task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")
        : "_No acceptance criteria defined._";
    result = result.replace(/\{\{acceptanceCriteria\}\}/g, criteriaList);

    // Replace {{parentIssueLink}}
    const parentLink = `dev-workflow issue #${issue.number}: ${issue.title}`;
    result = result.replace(/\{\{parentIssueLink\}\}/g, parentLink);

    return result;
  }

  /**
   * Append dev-workflow footer to body
   */
  private appendFooter(body: string, issue: Issue, task: Task): string {
    return `${body}\n\n---\nTask ${issue.number}.${task.number}: ${task.title}`;
  }

  /**
   * Build default task body (fallback when no template)
   */
  private buildDefaultTaskBody(issue: Issue, task: Task): string {
    const sections: string[] = [task.description];

    if (task.acceptanceCriteria.length > 0) {
      sections.push("\n## Acceptance Criteria\n");
      for (const criterion of task.acceptanceCriteria) {
        sections.push(`- [ ] ${criterion}`);
      }
    }

    // Add dev-workflow reference as unobtrusive footer note
    sections.push("");
    sections.push("---");
    sections.push(`Task ${issue.number}.${task.number}: ${task.title}`);

    return sections.join("\n");
  }

  /**
   * Build labels array from task type
   */
  private buildLabels(taskType: string): Effect<string[]> {
    const self = this;
    return Effect.gen(function* () {
      const labels: string[] = [];

      // Look up the remote label for this task type via TypeService
      let typeLabel: string | undefined;

      if (self.typeService) {
        try {
          const typeDef = yield* self.typeService!.getTypeByName(taskType);
          if (typeDef) {
            typeLabel = typeDef.remoteLabel;
          }
        } catch {
          // Log but don't fail - fall back to lowercase
          console.warn(`Failed to look up type ${taskType}, falling back to lowercase`);
        }
      }

      // Fallback to lowercase type name if no TypeService or no explicit label
      if (!typeLabel) {
        typeLabel = taskType.toLowerCase();
      }

      labels.push(typeLabel);

      // Add custom labels from provider config
      const customLabels = self.projectManagement.getCustomLabels();
      labels.push(...customLabels);

      // Add a "task" label to distinguish task issues from regular issues
      labels.push("task");

      return labels;
    });
  }

  /**
   * Sync task labels to GitHub Project custom fields
   */
  private syncLabelsToProjectFields(
    remoteProjectId: string,
    projectId: string,
    labels: Record<string, string> | undefined | null,
    labelFieldMapping: Record<string, string>
  ): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      if (!labels || Object.keys(labels).length === 0) {
        return;
      }

      // Sync each mapped label
      for (const [labelKey, labelValue] of Object.entries(labels)) {
        const fieldId = labelFieldMapping[labelKey];
        if (!fieldId) {
          // Label not mapped - skip
          continue;
        }

        try {
          if (labelValue === "" || labelValue === null || labelValue === undefined) {
            // Empty value - clear the field
            const result = yield* self.projectManagement.clearProjectItemField(
              projectId,
              remoteProjectId,
              fieldId
            );
            if (!result.success) {
              console.warn(`Failed to clear field ${labelKey}: ${result.error}`);
            }
          } else {
            // Non-empty value - set the field
            const result = yield* self.projectManagement.setProjectItemField(
              projectId,
              remoteProjectId,
              fieldId,
              labelValue
            );
            if (!result.success) {
              console.warn(`Failed to set field ${labelKey}=${labelValue}: ${result.error}`);
            }
          }
        } catch (error) {
          // Log but don't fail - best effort sync
          console.warn(
            `Error syncing label ${labelKey} to project field: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });
  }
}

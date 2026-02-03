/**
 * TaskDomainService - Domain logic for task operations
 *
 * Encapsulates business rules over TaskRepository and PlanRepository.
 * Handles status transition validation. No external sync — that belongs
 * in operations or the existing TaskService.
 */

import type { Task, TaskStatus, PRStatus, TaskRepository } from "./task.js";
import type { PlanRepository } from "../plans/plan.js";
import type { IssueRepository } from "../issues/issue.js";
import { EntityNotFoundError, BusinessRuleError } from "../errors.js";
import { Effect, Service } from "@dev-workflow/effect";

// =============================================================================
// Request / Response Types
// =============================================================================

export interface AddManualTaskRequest {
  issueNumber: number;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
  insertAfterTaskId?: string;
}

export interface TaskSession {
  task: Task;
  sessionId: string;
  startedAt: string;
  resumed: boolean;
  worktreePath?: string;
  branchName?: string;
}

// =============================================================================
// Service
// =============================================================================

export class TaskDomainService extends Service<TaskDomainService>()("taskDomainService") {
  constructor(
    private readonly repo: TaskRepository,
    private readonly planRepo: PlanRepository,
    private readonly issueRepo: IssueRepository
  ) {
    super();
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  findById(taskId: string, includeDeleted = false): Effect<Task | null> {
    return this.repo.findById(taskId, includeDeleted);
  }

  getOrThrow(taskId: string): Effect<Task, EntityNotFoundError> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const task = yield* repo.findById(taskId);
      if (!task) {
        return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
      }
      return task;
    });
  }

  findByPlanId(planId: string, includeDeleted = false): Effect<Task[]> {
    return this.repo.findByPlanId(planId, includeDeleted);
  }

  findByIds(taskIds: string[]): Effect<Task[]> {
    return this.repo.findByIds(taskIds);
  }

  findMany(filters?: Parameters<TaskRepository["findMany"]>[0]): Effect<Task[]> {
    return this.repo.findMany(filters);
  }

  getStatusCounts(): Effect<Record<string, number>> {
    return this.repo.getStatusCounts();
  }

  /**
   * Get incomplete tasks for an issue.
   *
   * Returns non-terminal, non-deleted tasks via the plan.
   */
  getIncompleteTasksForIssue(issueId: string): Effect<Task[]> {
    const { repo, planRepo } = this;
    return Effect.gen(function* () {
      const plan = yield* planRepo.findByIssueId(issueId);
      if (!plan) return [];
      const tasks = yield* repo.findByPlanId(plan.id);
      return tasks.filter((t) => !t.isDeleted && !t.isTerminal);
    });
  }

  /**
   * Check if all tasks for an issue are in terminal state.
   */
  areAllTasksComplete(issueId: string): Effect<boolean> {
    const { repo, planRepo } = this;
    return Effect.gen(function* () {
      const plan = yield* planRepo.findByIssueId(issueId);
      if (!plan) return true;
      const tasks = yield* repo.findByPlanId(plan.id);
      return tasks.filter((t) => !t.isDeleted).every((t) => t.isTerminal);
    });
  }

  // ============================================================================
  // Status Transition Operations (domain validation only, no external sync)
  // ============================================================================

  /**
   * Move task to backlog.
   * Valid: PLANNED/READY -> BACKLOG
   */
  moveToBacklog(
    taskId: string,
    changedBy?: string
  ): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const task = yield* getOrThrow(taskId);
      const check = task.checkTransition("BACKLOG");
      if (!check.allowed) {
        return yield* Effect.fail(new BusinessRuleError(check.reason!));
      }
      return yield* repo.updateStatus(
        taskId,
        "BACKLOG",
        changedBy,
        `Moved to backlog from ${task.status}`
      );
    });
  }

  /**
   * Move task to ready.
   * Valid: BACKLOG -> READY
   */
  moveToReady(
    taskId: string,
    changedBy?: string
  ): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const task = yield* getOrThrow(taskId);
      const check = task.checkTransition("READY");
      if (!check.allowed) {
        return yield* Effect.fail(new BusinessRuleError(check.reason!));
      }
      return yield* repo.updateStatus(taskId, "READY", changedBy, "Moved to ready");
    });
  }

  /**
   * Start working on a task.
   * Valid: BACKLOG/READY -> IN_PROGRESS
   */
  start(taskId: string, changedBy?: string): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const task = yield* getOrThrow(taskId);
      const check = task.checkTransition("IN_PROGRESS");
      if (!check.allowed) {
        return yield* Effect.fail(new BusinessRuleError(check.reason!));
      }
      return yield* repo.updateStatus(taskId, "IN_PROGRESS", changedBy, "Task started");
    });
  }

  /**
   * Submit task for review.
   * Valid: IN_PROGRESS -> PR_REVIEW (force skips validation)
   */
  submitForReview(
    taskId: string,
    options?: { changedBy?: string; force?: boolean }
  ): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const { changedBy, force = false } = options ?? {};
      const task = yield* getOrThrow(taskId);
      if (!force) {
        const check = task.checkTransition("PR_REVIEW");
        if (!check.allowed) {
          return yield* Effect.fail(new BusinessRuleError(check.reason!));
        }
      }
      return yield* repo.updateStatus(taskId, "PR_REVIEW", changedBy, "Submitted for review");
    });
  }

  /**
   * Complete a task.
   * Valid: IN_PROGRESS/PR_REVIEW -> COMPLETED (force skips validation)
   */
  complete(
    taskId: string,
    options?: { changedBy?: string; notes?: string; force?: boolean }
  ): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const { changedBy, notes = "Task completed", force = false } = options ?? {};
      const task = yield* getOrThrow(taskId);
      if (!force) {
        const check = task.checkTransition("COMPLETED");
        if (!check.allowed) {
          return yield* Effect.fail(new BusinessRuleError(check.reason!));
        }
      }
      return yield* repo.updateStatus(taskId, "COMPLETED", changedBy, notes);
    });
  }

  /**
   * Abandon a task.
   * Valid: any non-terminal status -> ABANDONED
   */
  abandon(
    taskId: string,
    reason?: string,
    changedBy?: string
  ): Effect<Task, EntityNotFoundError | BusinessRuleError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      const task = yield* getOrThrow(taskId);
      if (task.isTerminal) {
        return yield* Effect.fail(
          new BusinessRuleError(`Task ${taskId} is already in terminal state: ${task.status}`)
        );
      }
      return yield* repo.updateStatus(
        taskId,
        "ABANDONED" as TaskStatus,
        changedBy ?? "system",
        reason ?? "Task abandoned"
      );
    });
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  update(taskId: string, data: Parameters<TaskRepository["update"]>[1]): Effect<Task> {
    return this.repo.update(taskId, data);
  }

  softDelete(taskId: string, deletedBy?: string): Effect<Task> {
    return this.repo.softDelete(taskId, deletedBy);
  }

  updatePRInfo(taskId: string, prUrl: string, prNumber: number, prStatus: PRStatus): Effect<void> {
    return Effect.map(
      this.repo.updatePRInfo(taskId, prUrl, prNumber, prStatus),
      () => undefined as void
    );
  }

  updatePRStatus(taskId: string, prStatus: PRStatus): Effect<void> {
    return Effect.map(this.repo.updatePRStatus(taskId, prStatus), () => undefined as void);
  }

  clearSession(taskId: string): Effect<void> {
    return Effect.map(this.repo.clearSession(taskId), () => undefined as void);
  }

  clearWorktreeInfo(taskId: string): Effect<void> {
    return Effect.map(this.repo.clearWorktreeInfo(taskId), () => undefined as void);
  }

  // ============================================================================
  // Manual Task Operations
  // ============================================================================

  /**
   * Add a manual task to a plan.
   *
   * Manual tasks are protected from plan regeneration.
   */
  addManualTask(request: AddManualTaskRequest): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const {
        issueNumber,
        title,
        description,
        acceptanceCriteria,
        estimatedMinutes,
        insertAfterTaskId,
      } = request;

      // Find the issue
      const issue = yield* self.issueRepo.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      // Find the plan for this issue
      const plan = yield* self.planRepo.findByIssueId(issue.id);
      if (!plan) {
        throw new Error(`No plan exists for issue #${issueNumber}. Generate a plan first.`);
      }

      // Validate insertAfterTaskId if provided
      if (insertAfterTaskId) {
        const afterTask = yield* self.repo.findById(insertAfterTaskId);
        if (!afterTask) {
          throw new Error(`Task not found: ${insertAfterTaskId}`);
        }
        if (afterTask.planId !== plan.id) {
          throw new Error(`Task ${insertAfterTaskId} does not belong to this plan`);
        }
      }

      // Create the manual task
      const task = yield* self.repo.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title,
        description,
        acceptanceCriteria: acceptanceCriteria ?? [],
        status: "BACKLOG",
        type: "TASK",
        source: "manual",
        estimatedMinutes,
        isDeleted: false,
      });

      return task;
    });
  }

  /**
   * Soft-delete a PLANNED task.
   *
   * Tasks past PLANNED status should use abandon instead.
   */
  deleteTask(taskId: string, deletedBy?: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      // Use includeDeleted=true to distinguish "not found" from "already deleted"
      const task = yield* self.repo.findById(taskId, true);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (task.isDeleted) {
        throw new Error(`Task is already deleted: ${taskId}`);
      }

      if (task.status !== "PLANNED") {
        throw new Error(
          `Cannot delete task with status ${task.status}. Tasks can only be deleted while in PLANNED status. ` +
            `Use abandon_task instead to mark the task as abandoned.`
        );
      }

      return yield* self.repo.softDelete(taskId, deletedBy);
    });
  }

  /**
   * Restore a soft-deleted task.
   */
  restoreTask(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      // IMPORTANT: use includeDeleted=true so we can find the deleted task
      const task = yield* self.repo.findById(taskId, true);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (!task.isDeleted) {
        throw new Error(`Task is not deleted: ${taskId}`);
      }

      return yield* self.repo.restore(taskId);
    });
  }

  /**
   * Get tasks for an issue via issue→plan→tasks lookup.
   */
  getTasksForIssue(issueNumber: number, includeDeleted = false): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const issue = yield* self.issueRepo.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      const plan = yield* self.planRepo.findByIssueId(issue.id);
      if (!plan) {
        return [];
      }

      return yield* self.repo.findByPlanId(plan.id, includeDeleted);
    });
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Activate a plan by transitioning BACKLOG→READY for all tasks
   * except the one being started.
   */
  activatePlan(planId: string, excludeTaskId: string, changedBy: string): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const allPlanTasks = yield* self.repo.findByPlanId(planId);
      const activated: Task[] = [];
      for (const planTask of allPlanTasks) {
        if (planTask.status === "BACKLOG" && planTask.id !== excludeTaskId) {
          const updated = yield* self.repo.updateStatus(
            planTask.id,
            "READY",
            changedBy,
            "Plan activated - task moved from BACKLOG to READY"
          );
          activated.push(updated);
        }
      }
      return activated;
    });
  }

  /**
   * Update session info (sessionId, startedAt, activityAt) for a task.
   */
  updateSessionInfo(
    taskId: string,
    sessionId: string,
    startedAt?: string,
    activityAt?: string
  ): Effect<void> {
    return Effect.map(
      this.repo.updateSessionInfo(taskId, sessionId, startedAt, activityAt),
      () => undefined as void
    );
  }

  /**
   * Update worktree info (path and branch) for a task.
   */
  updateWorktreeInfo(taskId: string, worktreePath: string, branchName: string): Effect<void> {
    return Effect.map(
      this.repo.updateWorktreeInfo(taskId, worktreePath, branchName),
      () => undefined as void
    );
  }

  /**
   * Session heartbeat — validates session ownership and updates activity timestamp.
   */
  updateSessionActivity(taskId: string, sessionId: string): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (task.sessionId !== sessionId) {
        throw new Error(
          `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}`
        );
      }
      const now = new Date().toISOString();
      yield* self.repo.updateSessionInfo(taskId, sessionId, undefined, now);
    });
  }

  /**
   * Check if a task is available for work.
   */
  isTaskAvailable(taskId: string): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.repo.findById(taskId);
      if (!task) return false;
      return yield* self.checkTaskAvailability(task);
    });
  }

  /**
   * Get active session info for a task, or null if no active session.
   */
  getActiveSession(taskId: string): Effect<TaskSession | null> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.repo.findById(taskId);
      if (!task || !task.sessionId || !task.sessionStartedAt) {
        return null;
      }
      return {
        task,
        sessionId: task.sessionId,
        startedAt: task.sessionStartedAt,
        resumed: true,
      };
    });
  }

  /**
   * Check if all dependency tasks are in terminal state.
   */
  areDependenciesSatisfied(task: Task): Effect<boolean> {
    if (!task.dependsOn?.length) return Effect.succeed(true);
    const self = this;
    return Effect.gen(function* () {
      const deps = yield* self.repo.findByIds(task.dependsOn!);
      return deps.every((d) => d.isTerminal);
    });
  }

  /**
   * Get non-terminal blocking dependency tasks.
   */
  getBlockingDependencies(task: Task): Effect<Task[]> {
    if (!task.dependsOn?.length) return Effect.succeed([]);
    const self = this;
    return Effect.gen(function* () {
      const deps = yield* self.repo.findByIds(task.dependsOn!);
      return deps.filter((d) => !d.isTerminal);
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private checkTaskAvailability(task: Task): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      // Check if parent issue is closed
      const plan = yield* self.planRepo.findById(task.planId);
      if (plan) {
        const issue = yield* self.issueRepo.findById(plan.issueId);
        if (issue && issue.isClosed) {
          return false;
        }
      }
      // Only BACKLOG and READY tasks are available for fresh starts
      if (task.status === "BACKLOG" || task.status === "READY") {
        return yield* self.areDependenciesSatisfied(task);
      }
      return false;
    });
  }
}

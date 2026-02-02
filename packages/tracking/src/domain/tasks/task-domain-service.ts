/**
 * TaskDomainService - Domain logic for task operations
 *
 * Encapsulates business rules over TaskRepository and PlanRepository.
 * Handles status transition validation. No external sync — that belongs
 * in operations or the existing TaskService.
 */

import type { Task, TaskStatus, PRStatus, TaskRepository } from "./task.js";
import type { PlanRepository } from "../plans/plan.js";
import { EntityNotFoundError, BusinessRuleError } from "../errors.js";
import { Effect } from "@dev-workflow/effect";

export class TaskDomainService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly planRepo: PlanRepository
  ) {}

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
}

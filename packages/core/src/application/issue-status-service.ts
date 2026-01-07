/**
 * IssueStatusService - Computes derived issue status from task states
 *
 * This service encapsulates the logic for computing an issue's "real" status
 * based on its underlying tasks. The database stores simple PLANNED/OPEN/CLOSED
 * states, but the UI needs richer computed states like IN_PROGRESS and TASKS_DONE.
 *
 * Usage:
 * ```typescript
 * const service = new IssueStatusService(planRepository, taskRepository);
 * const { computedStatus, taskCounts } = service.computeStatus(issue);
 * ```
 */

import type { Issue } from "../domain/issue.js";
import type { Plan, PlanRepository } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Computed issue status based on task states.
 *
 * This is distinct from Issue.status (PLANNED/OPEN/CLOSED) as it provides
 * a more granular view of issue progress.
 */
export type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

/**
 * Task progress counts for an issue
 */
export interface TaskCounts {
  /** Total number of tasks */
  readonly total: number;
  /** Number of completed tasks */
  readonly completed: number;
  /** Number of in-progress tasks (includes PR_REVIEW) */
  readonly inProgress: number;
}

/**
 * Result of computing issue status
 */
export interface ComputedStatusResult {
  /** The computed status */
  readonly computedStatus: ComputedIssueStatus;
  /** Task counts (undefined if no plan/tasks) */
  readonly taskCounts?: TaskCounts;
}

// =============================================================================
// Service
// =============================================================================

/**
 * Service for computing issue status from task states
 *
 * This is a stateless service that takes repositories via constructor injection.
 * The same instance can be used for multiple computations.
 */
export class IssueStatusService {
  constructor(
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository
  ) {}

  /**
   * Compute the status for a single issue
   *
   * Status computation rules:
   * 1. PLANNED → issue.status is PLANNED (not yet moved to backlog)
   * 2. CLOSED → issue.status is CLOSED
   * 3. OPEN → no plan, or plan with no tasks, or all tasks are backlog/ready
   * 4. IN_PROGRESS → at least one task is IN_PROGRESS or PR_REVIEW
   * 5. TASKS_DONE → all tasks are COMPLETED or ABANDONED
   *
   * @param issue - The issue to compute status for
   * @returns Computed status and optional task counts
   */
  computeStatus(issue: Issue): ComputedStatusResult {
    // Check explicit statuses first
    if (issue.status === "PLANNED") {
      return { computedStatus: "PLANNED" };
    }
    if (issue.status === "CLOSED") {
      return { computedStatus: "CLOSED" };
    }

    // Get plan and tasks
    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      return { computedStatus: "OPEN" };
    }

    const tasks = this.taskRepository.findByPlanId(plan.id);
    if (tasks.length === 0) {
      return { computedStatus: "OPEN" };
    }

    // Count task states
    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

    const taskCounts: TaskCounts = {
      total: tasks.length,
      completed,
      inProgress: inProgress + prReview,
    };

    // Determine computed status
    let computedStatus: ComputedIssueStatus;
    if (completed + abandoned === tasks.length) {
      computedStatus = "TASKS_DONE";
    } else if (inProgress === 0 && prReview === 0) {
      computedStatus = "OPEN";
    } else {
      computedStatus = "IN_PROGRESS";
    }

    return { computedStatus, taskCounts };
  }

  /**
   * Compute status from pre-loaded data (avoids repository calls)
   *
   * Use this when you already have the plan and tasks loaded,
   * for example in batch operations.
   *
   * @param issue - The issue
   * @param plan - The plan (or null)
   * @param tasks - The tasks (empty array if no plan)
   * @returns Computed status and optional task counts
   */
  computeStatusFromData(issue: Issue, plan: Plan | null, tasks: Task[]): ComputedStatusResult {
    // Check explicit statuses first
    if (issue.status === "PLANNED") {
      return { computedStatus: "PLANNED" };
    }
    if (issue.status === "CLOSED") {
      return { computedStatus: "CLOSED" };
    }

    // No plan = OPEN
    if (!plan) {
      return { computedStatus: "OPEN" };
    }

    // No tasks = OPEN
    if (tasks.length === 0) {
      return { computedStatus: "OPEN" };
    }

    // Count task states
    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

    const taskCounts: TaskCounts = {
      total: tasks.length,
      completed,
      inProgress: inProgress + prReview,
    };

    // Determine computed status
    let computedStatus: ComputedIssueStatus;
    if (completed + abandoned === tasks.length) {
      computedStatus = "TASKS_DONE";
    } else if (inProgress === 0 && prReview === 0) {
      computedStatus = "OPEN";
    } else {
      computedStatus = "IN_PROGRESS";
    }

    return { computedStatus, taskCounts };
  }
}

// =============================================================================
// Standalone Function (for cases where DI is not available)
// =============================================================================

/**
 * Compute issue status from pre-loaded data without a service instance
 *
 * This is a pure function that doesn't require repository access.
 * Useful for client-side computation where repositories aren't available.
 *
 * @param issue - The issue
 * @param tasks - The tasks (empty array if no plan)
 * @returns Computed status
 */
export function computeIssueStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
  if (issue.status === "PLANNED") {
    return "PLANNED";
  }
  if (issue.status === "CLOSED") {
    return "CLOSED";
  }
  if (tasks.length === 0) {
    return "OPEN";
  }

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

  if (completed + abandoned === tasks.length) {
    return "TASKS_DONE";
  }
  if (inProgress === 0 && prReview === 0) {
    return "OPEN";
  }
  return "IN_PROGRESS";
}

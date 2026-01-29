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

import type { Issue } from "./issue.js";
import { type ComputedIssueStatus, computeIssueStatus } from "./issue.js";
import type { Plan } from "../plans/plan.js";
import type { Task } from "../tasks/task.js";
import { isTerminal, isActive } from "../tasks/task.js";
import type { DbClient } from "../data-access/db-client.js";

// Re-export ComputedIssueStatus for backwards compatibility
export type { ComputedIssueStatus } from "./issue.js";

/**
 * Task progress counts for an issue
 */
export interface TaskCounts {
  /** Total number of tasks */
  readonly total: number;
  /** Number of terminal tasks (COMPLETED or ABANDONED) for progress calculation */
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
  constructor(private readonly db: DbClient) {}

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
    // Get plan and tasks
    const plan = this.db.plans.findByIssueId(issue.id);
    const tasks = plan ? this.db.tasks.findByPlanId(plan.id) : [];

    // Use domain function for status computation
    const status = computeIssueStatus(issue, tasks);

    if (tasks.length === 0) {
      return { computedStatus: status };
    }

    // Count task states using trait functions (single source of truth)
    const terminal = tasks.filter(isTerminal).length;
    const active = tasks.filter(isActive).length;

    const taskCounts: TaskCounts = {
      total: tasks.length,
      completed: terminal,
      inProgress: active,
    };

    return { computedStatus: status, taskCounts };
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
  computeStatusFromData(issue: Issue, _plan: Plan | null, tasks: Task[]): ComputedStatusResult {
    // Use domain function for status computation
    const status = computeIssueStatus(issue, tasks);

    if (tasks.length === 0) {
      return { computedStatus: status };
    }

    // Count task states using trait functions (single source of truth)
    const terminal = tasks.filter(isTerminal).length;
    const active = tasks.filter(isActive).length;

    const taskCounts: TaskCounts = {
      total: tasks.length,
      completed: terminal,
      inProgress: active,
    };

    return { computedStatus: status, taskCounts };
  }
}

// =============================================================================
// Standalone Function (for cases where DI is not available)
// =============================================================================

// Re-export the domain function for backwards compatibility
export { computeIssueStatus } from "./issue.js";

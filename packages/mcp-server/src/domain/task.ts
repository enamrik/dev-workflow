/**
 * Domain types for Task entity
 */

import type { HookResult } from "./hook-config.js";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";

/**
 * Task entity
 *
 * Represents an individual implementation step within a plan.
 * Tasks have status tracking and can be smart-matched across plan versions.
 */
export interface Task {
  readonly id: string; // UUID
  readonly snapshotId: string; // Foreign key to Snapshot
  readonly planId: string; // Foreign key to Plan
  readonly order: number; // Display order (1, 2, 3, ...)
  readonly title: string; // Short task title
  readonly description: string; // Detailed task description
  readonly acceptanceCriteria: string[]; // How to verify completion
  readonly status: TaskStatus;
  readonly estimatedMinutes?: number; // Optional time estimate
  readonly matchedFromTaskId?: string; // If preserved from previous version
  readonly matchConfidence?: number; // 0.0-1.0 matching score

  // Session tracking (mutable fields updated in place)
  readonly sessionId?: string; // Current Claude session working on this task
  readonly sessionStartedAt?: string; // When current session began
  readonly lastSessionActivityAt?: string; // Last activity in session (for timeout detection)

  // Hook configuration references (composable, mutable)
  readonly hookConfigLabels?: string[]; // Array of labels, each references .track/issues/tasks/hooks/<label>.yml
  // Hooks are merged together: ["db-migration", "e2e-tests", "security"]

  readonly startedAt?: string; // When task moved to IN_PROGRESS
  readonly completedAt?: string; // When task moved to COMPLETED
  readonly abandonedAt?: string; // When task moved to ABANDONED
  readonly createdAt: string; // ISO date string
  readonly updatedAt: string; // ISO date string
}

/**
 * Task status history entry
 *
 * Tracks status changes for audit trail without creating full snapshots.
 */
export interface TaskStatusHistory {
  readonly id: string; // UUID
  readonly taskId: string; // Foreign key to Task
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
  readonly changedBy?: string; // Optional: who made the change
  readonly changedAt: string; // ISO date string
  readonly notes?: string; // Optional notes about the change
  readonly sessionId?: string; // Which session made this change
  readonly hookResults?: HookResult[]; // Results of hooks that ran during this transition
}

/**
 * Filters for querying tasks
 */
export interface TaskFilters {
  planId?: string;
  snapshotId?: string;
  status?: TaskStatus;
}

/**
 * Repository interface for Task persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 */
export interface TaskRepository {
  /**
   * Create a new task
   *
   * Automatically assigns order based on existing tasks for the plan.
   *
   * @param task - Task data (without id, order, createdAt, updatedAt which are generated)
   * @returns The created task with id, order, and timestamps assigned
   */
  create(
    task: Omit<Task, "id" | "order" | "createdAt" | "updatedAt">
  ): Task;

  /**
   * Create multiple tasks for a plan (batch operation)
   *
   * More efficient than creating tasks one by one.
   * Automatically assigns sequential order numbers.
   *
   * @param tasks - Array of task data
   * @returns Array of created tasks with ids, orders, and timestamps assigned
   */
  createMany(
    tasks: Omit<Task, "id" | "order" | "createdAt" | "updatedAt">[]
  ): Task[];

  /**
   * Find a task by its UUID
   *
   * @param id - Task UUID
   * @returns The task if found, null otherwise
   */
  findById(id: string): Task | null;

  /**
   * Find all tasks for a plan
   *
   * Returns tasks ordered by 'order' ASC.
   *
   * @param planId - Plan UUID
   * @returns Array of tasks for the plan
   */
  findByPlanId(planId: string): Task[];

  /**
   * Find all tasks for a snapshot
   *
   * Returns tasks ordered by plan and order.
   *
   * @param snapshotId - Snapshot UUID
   * @returns Array of tasks for the snapshot
   */
  findBySnapshotId(snapshotId: string): Task[];

  /**
   * Find all tasks matching filters
   *
   * @param filters - Optional filters for planId, snapshotId, and status
   * @returns Array of matching tasks
   */
  findMany(filters?: TaskFilters): Task[];

  /**
   * Update task status with automatic timestamp tracking
   *
   * Automatically sets startedAt, completedAt, or abandonedAt based on status.
   * Records the status change in task_status_history.
   *
   * @param id - Task UUID
   * @param status - New status
   * @param changedBy - Optional: who made the change
   * @param notes - Optional notes about the change
   * @returns The updated task
   */
  updateStatus(
    id: string,
    status: TaskStatus,
    changedBy?: string,
    notes?: string
  ): Task;

  /**
   * Get the next order number for a plan
   *
   * Used internally by create() to assign sequential order numbers.
   *
   * @param planId - Plan UUID
   * @returns The next order number (MAX(order) + 1, or 1 if no tasks exist)
   */
  getNextOrder(planId: string): number;

  /**
   * Update session information for a task
   *
   * Updates sessionId, sessionStartedAt, and lastSessionActivityAt.
   * Used when starting a session or updating session activity (heartbeat).
   *
   * @param taskId - Task UUID
   * @param sessionId - Session ID to associate
   * @param sessionStartedAt - When session started (optional, only set when starting)
   * @param lastSessionActivityAt - Last activity timestamp (for heartbeat)
   * @returns The updated task
   */
  updateSessionInfo(
    taskId: string,
    sessionId: string,
    sessionStartedAt?: string,
    lastSessionActivityAt?: string
  ): Task;

  /**
   * Clear session association from a task
   *
   * Sets sessionId, sessionStartedAt, and lastSessionActivityAt to undefined.
   * Used when completing or abandoning a session.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearSession(taskId: string): Task;

  /**
   * Update hook configuration labels for a task
   *
   * Allows UI to dynamically change which hook configs are associated with a task.
   *
   * @param taskId - Task UUID
   * @param labels - Array of hook config labels (e.g., ["db-migration", "e2e-tests"])
   * @returns The updated task
   */
  updateHookConfigLabels(taskId: string, labels: string[]): Task;
}

/**
 * Domain types for Task entity
 */

import type { GitHubSyncState } from "./github.js";

export type TaskStatus =
  | "PLANNED"
  | "BACKLOG"
  | "READY"
  | "IN_PROGRESS"
  | "PR_REVIEW"
  | "COMPLETED"
  | "ABANDONED";

/**
 * Valid task status transitions
 *
 * Defines which status transitions are allowed in the task lifecycle.
 * Key transitions:
 * - PLANNED → BACKLOG: Issue activated via move_issue_to_backlog (GitHub issues created)
 * - BACKLOG → READY: Plan activation (any task started)
 * - READY → BACKLOG: Issue paused
 * - BACKLOG/READY → IN_PROGRESS: Task started
 * - IN_PROGRESS → PR_REVIEW: Task submitted for review
 * - IN_PROGRESS → COMPLETED: Direct completion (main mode)
 * - PR_REVIEW → COMPLETED: PR merged
 * - Any → ABANDONED: Task abandoned
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PLANNED: ["BACKLOG", "ABANDONED"], // PLANNED → BACKLOG when issue activated
  BACKLOG: ["READY", "IN_PROGRESS", "ABANDONED"],
  READY: ["BACKLOG", "IN_PROGRESS", "ABANDONED"],
  IN_PROGRESS: ["PR_REVIEW", "COMPLETED", "ABANDONED"],
  PR_REVIEW: ["COMPLETED", "ABANDONED"],
  COMPLETED: [], // Terminal state - no transitions allowed
  ABANDONED: [], // Terminal state - no transitions allowed
};

/**
 * Check if a status transition is valid
 *
 * @param from - Current status
 * @param to - Target status
 * @returns true if the transition is allowed
 */
export function isValidStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
  // Same status transition is a no-op, not an error
  if (from === to) {
    return true;
  }

  const allowedTransitions = VALID_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}

/**
 * Get allowed transitions from a given status
 *
 * @param status - Current status
 * @returns Array of allowed target statuses
 */
export function getAllowedTransitions(status: TaskStatus): TaskStatus[] {
  return [...VALID_TRANSITIONS[status]];
}
export type TaskSource = "generated" | "manual";
export type PRStatus = "DRAFT" | "OPEN" | "MERGED" | "CLOSED";

/**
 * Task entity
 *
 * Represents an individual implementation step within a plan.
 * Tasks have status tracking and can be smart-matched across plan versions.
 */
export interface Task {
  readonly id: string; // UUID
  readonly planId: string; // Foreign key to Plan
  readonly number: number; // Task number within plan (1, 2, 3) - stable identifier displayed as issueNumber.taskNumber
  readonly order: number; // Display order (1, 2, 3, ...) - can differ from number after reordering
  readonly title: string; // Short task title
  readonly description: string; // Detailed task description
  readonly acceptanceCriteria: string[]; // How to verify completion
  readonly status: TaskStatus;
  readonly source: TaskSource; // Whether task was generated or manually created
  readonly estimatedMinutes?: number; // Optional time estimate
  readonly matchedFromTaskId?: string; // If preserved from previous version
  readonly matchConfidence?: number; // 0.0-1.0 matching score

  // Soft delete support
  readonly isDeleted: boolean; // Whether task is soft deleted
  readonly deletedAt?: string; // When task was deleted
  readonly deletedBy?: string; // Who deleted the task

  // Session tracking (mutable fields updated in place)
  readonly sessionId?: string; // Current Claude session working on this task
  readonly sessionStartedAt?: string; // When current session began
  readonly lastSessionActivityAt?: string; // Last activity in session (for timeout detection)

  // Labels (references .track/labels/<label>.md files)
  readonly labels?: string[]; // Array of labels, each references .track/labels/<label>.md

  // Execution context
  readonly contextInstructions?: string; // Custom instructions for task execution (e.g., "use existing auth pattern in src/auth")

  // Task dependencies - array of task IDs that must be COMPLETED or ABANDONED before this task can start
  readonly dependsOn?: string[]; // Array of task UUIDs within the same plan

  // Git worktree support (for isolated task execution)
  readonly worktreePath?: string; // Path to worktree directory (e.g., .worktrees/issue-5-task-abc123)
  readonly branchName?: string; // Git branch name (e.g., issue-5/task-1-add-feature)

  // GitHub PR integration (for code review workflow)
  readonly prUrl?: string; // GitHub PR URL
  readonly prNumber?: number; // GitHub PR number
  readonly prStatus?: PRStatus; // PR state

  // GitHub issue sync state (for task-level GitHub issues)
  readonly githubSync?: GitHubSyncState;

  readonly startedAt?: string; // When task moved to IN_PROGRESS
  readonly submittedForReviewAt?: string; // When task moved to PR_REVIEW
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
}

/**
 * Task execution log entry
 *
 * Records progress during task execution for audit trail.
 * Sessions call log_task_progress to record what they're doing,
 * and the logs can be retrieved to see execution history.
 */
export interface TaskExecutionLog {
  readonly id: string; // UUID
  readonly taskId: string; // Foreign key to Task
  readonly sessionId: string; // Which session logged this entry
  readonly message: string; // What was done (e.g., "Created user model in src/models/user.ts")
  readonly filesModified?: string[]; // Optional list of files touched
  readonly createdAt: string; // ISO date string
}

/**
 * Filters for querying tasks
 */
export interface TaskFilters {
  planId?: string;
  status?: TaskStatus;
  source?: TaskSource;
  includeDeleted?: boolean; // Default: false
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
   * Automatically assigns number and order based on existing tasks for the plan.
   * Caller must provide task id (for dependency tracking).
   *
   * @param task - Task data (without number, order, createdAt, updatedAt which are generated)
   * @returns The created task with number, order and timestamps assigned
   */
  create(task: Omit<Task, "number" | "order" | "createdAt" | "updatedAt">): Task;

  /**
   * Create multiple tasks for a plan (batch operation)
   *
   * More efficient than creating tasks one by one.
   * Automatically assigns sequential number and order values.
   * Caller must provide task ids (for dependency tracking).
   *
   * @param tasks - Array of task data with ids
   * @returns Array of created tasks with numbers, orders and timestamps assigned
   */
  createMany(tasks: Omit<Task, "number" | "order" | "createdAt" | "updatedAt">[]): Task[];

  /**
   * Find a task by its UUID
   *
   * @param id - Task UUID
   * @returns The task if found, null otherwise
   */
  findById(id: string): Task | null;

  /**
   * Find multiple tasks by their UUIDs
   *
   * @param ids - Array of task UUIDs
   * @returns Array of found tasks (may be fewer than requested if some not found)
   */
  findByIds(ids: string[]): Task[];

  /**
   * Find all tasks for a plan
   *
   * Returns tasks ordered by 'order' ASC.
   * By default, excludes soft-deleted tasks.
   *
   * @param planId - Plan UUID
   * @param includeDeleted - Whether to include soft-deleted tasks (default: false)
   * @returns Array of tasks for the plan
   */
  findByPlanId(planId: string, includeDeleted?: boolean): Task[];

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
  updateStatus(id: string, status: TaskStatus, changedBy?: string, notes?: string): Task;

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
   * Get the next task number for a plan
   *
   * Used internally by create() to assign sequential task numbers.
   * Task numbers are stable identifiers that don't change when tasks are reordered.
   *
   * @param planId - Plan UUID
   * @returns The next task number (MAX(number) + 1, or 1 if no tasks exist)
   */
  getNextTaskNumber(planId: string): number;

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
   * Update worktree information for a task
   *
   * Sets worktreePath and branchName for isolated task execution.
   *
   * @param taskId - Task UUID
   * @param worktreePath - Path to worktree directory
   * @param branchName - Git branch name
   * @returns The updated task
   */
  updateWorktreeInfo(taskId: string, worktreePath: string, branchName: string): Task;

  /**
   * Clear worktree information from a task
   *
   * Sets worktreePath and branchName to undefined.
   * Used when task is completed or abandoned.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearWorktreeInfo(taskId: string): Task;

  /**
   * Update PR information for a task
   *
   * Sets prUrl, prNumber, and prStatus for GitHub PR integration.
   *
   * @param taskId - Task UUID
   * @param prUrl - GitHub PR URL
   * @param prNumber - GitHub PR number
   * @param prStatus - PR status (DRAFT, OPEN, MERGED, CLOSED)
   * @returns The updated task
   */
  updatePRInfo(taskId: string, prUrl: string, prNumber: number, prStatus: PRStatus): Task;

  /**
   * Update PR status for a task
   *
   * Updates only the prStatus field.
   *
   * @param taskId - Task UUID
   * @param prStatus - New PR status
   * @returns The updated task
   */
  updatePRStatus(taskId: string, prStatus: PRStatus): Task;

  /**
   * Clear PR information from a task
   *
   * Sets prUrl, prNumber, and prStatus to undefined.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearPRInfo(taskId: string): Task;

  /**
   * Update labels for a task
   *
   * Allows UI to dynamically change which labels are associated with a task.
   *
   * @param taskId - Task UUID
   * @param labels - Array of labels (e.g., ["db", "api", "security"])
   * @returns The updated task
   */
  updateLabels(taskId: string, labels: string[]): Task;

  /**
   * Update a task's properties
   *
   * General purpose update method for task fields.
   *
   * @param id - Task UUID
   * @param data - Partial task data to update
   * @returns The updated task
   */
  update(
    id: string,
    data: Partial<Omit<Task, "id" | "planId" | "order" | "createdAt" | "isDeleted">>
  ): Task;

  /**
   * Soft delete a task
   *
   * Marks the task as deleted without removing it from the database.
   * Only PLANNED, BACKLOG, or READY tasks can be soft deleted.
   *
   * @param id - Task UUID
   * @param deletedBy - Who deleted the task
   * @returns The soft-deleted task
   */
  softDelete(id: string, deletedBy?: string): Task;

  /**
   * Restore a soft-deleted task
   *
   * Unmarks the task as deleted.
   *
   * @param id - Task UUID
   * @returns The restored task
   */
  restore(id: string): Task;

  /**
   * Update GitHub sync information for a task
   *
   * Sets the GitHub issue sync state (number, URL, node ID, etc.).
   * Called when a GitHub issue is created for the task.
   *
   * @param taskId - Task UUID
   * @param syncState - GitHub sync state to set
   * @returns The updated task
   */
  updateGitHubSync(taskId: string, syncState: GitHubSyncState): Task;

  /**
   * Clear GitHub sync information from a task
   *
   * Removes GitHub sync state. Used if GitHub issue is deleted.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearGitHubSync(taskId: string): Task;
}

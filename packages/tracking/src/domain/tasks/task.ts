/**
 * Domain types for Task entity
 */

import type { Effect } from "@dev-workflow/effect";
import type { SyncState } from "../../project-sync/project-management-provider.js";
import type { IssueType } from "../issues/issue.js";

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

// =============================================================================
// Status Traits (Single Source of Truth)
// =============================================================================

/**
 * Table-driven status traits - single source of truth for status semantics.
 *
 * Traits:
 * - terminal: Task is in a final state (COMPLETED, ABANDONED)
 * - workable: Task can be actively worked on (BACKLOG, READY, IN_PROGRESS)
 * - active: Work is currently in progress (IN_PROGRESS, PR_REVIEW)
 *
 * Use the exported trait functions (isTerminal, isWorkable, isActive) to query.
 * Adding a new status requires adding an entry here - TypeScript enforces exhaustiveness.
 */
const STATUS_TRAITS = {
  PLANNED: { terminal: false, workable: false, active: false },
  BACKLOG: { terminal: false, workable: true, active: false },
  READY: { terminal: false, workable: true, active: false },
  IN_PROGRESS: { terminal: false, workable: true, active: true },
  PR_REVIEW: { terminal: false, workable: false, active: true },
  COMPLETED: { terminal: true, workable: false, active: false },
  ABANDONED: { terminal: true, workable: false, active: false },
} as const satisfies Record<TaskStatus, { terminal: boolean; workable: boolean; active: boolean }>;

// =============================================================================
// TransitionCheck
// =============================================================================

/**
 * Result of checking whether a status transition is allowed
 */
export interface TransitionCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

// =============================================================================
// Task Interface (data fields)
// =============================================================================

export type TaskSource = "generated" | "manual";
export type PRStatus = "DRAFT" | "OPEN" | "MERGED" | "CLOSED";

/**
 * Task entity
 *
 * Represents an individual implementation step within a plan.
 * Tasks have status tracking and can be smart-matched across plan versions.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Task {
  readonly id: string; // UUID
  readonly planId: string; // Foreign key to Plan
  readonly number: number; // Sequential task number (1, 2, 3...) - renumbered when regenerating in PLANNED state, immutable after activation
  readonly order: number; // Display order (1, 2, 3, ...) - can differ from number after reordering
  readonly title: string; // Short task title
  readonly description: string; // Detailed task description
  readonly acceptanceCriteria: string[]; // How to verify completion
  readonly status: TaskStatus;
  readonly type: IssueType; // Task type - same vocabulary as issues (FEATURE, BUG, ENHANCEMENT, TASK)
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

  // Execution context - technical implementation details for Claude
  readonly implementationPlan?: string; // Technical implementation details for task execution (e.g., specific patterns to use, file locations)

  // Task dependencies - array of task IDs that must be COMPLETED or ABANDONED before this task can start
  readonly dependsOn?: string[]; // Array of task UUIDs within the same plan

  // Git worktree support (for isolated task execution)
  readonly worktreePath?: string; // Path to worktree directory (e.g., .worktrees/issue-5-task-abc123)
  readonly branchName?: string; // Git branch name (e.g., issue-5/task-1-add-feature)

  // PR integration (for code review workflow)
  readonly prUrl?: string; // PR URL
  readonly prNumber?: number; // PR number
  readonly prStatus?: PRStatus; // PR state

  // External sync state (for task-level external issues)
  readonly syncState?: SyncState;

  /**
   * Labels - unified metadata inherited from parent issue.
   * Supports both simple labels (empty value) and key-value pairs.
   * Example: { "bug": "", "product": "Case Workflow", "Product Area": "HR Portal" }
   */
  readonly labels?: Record<string, string>;

  readonly startedAt?: string; // When task moved to IN_PROGRESS
  readonly submittedForReviewAt?: string; // When task moved to PR_REVIEW
  readonly completedAt?: string; // When task moved to COMPLETED
  readonly abandonedAt?: string; // When task moved to ABANDONED
  readonly createdAt: string; // ISO date string
  readonly updatedAt: string; // ISO date string
}

// =============================================================================
// TaskData - Pure data fields without class methods
// =============================================================================

/**
 * TaskData represents the raw data fields of a Task without class methods.
 *
 * Use this type when constructing task data from plain objects (e.g., DB rows,
 * JSON, or spread expressions) before wrapping with Task.from().
 */
export type TaskData = {
  readonly [K in keyof Task as K extends
    | "isTerminal"
    | "isWorkable"
    | "isActive"
    | "allowedTransitions"
    | "checkTransition"
    | "canSubmitForReview"
    | "canComplete"
    | "canAbandon"
    | "canDelete"
    ? never
    : K]: Task[K];
};

// =============================================================================
// Task Class (declaration merging adds methods to the interface)
// =============================================================================

/**
 * Task class - adds domain methods to the Task interface via declaration merging.
 *
 * Use Task.from(data) to create an instance with methods attached.
 * Plain data objects (e.g., from JSON) are still valid Task interface instances
 * but won't have methods until wrapped with Task.from().
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Task {
  /**
   * Create a Task instance with domain methods from plain data.
   *
   * Uses Object.assign to attach the class prototype to the data object,
   * preserving all data fields while adding methods.
   */
  static from(data: TaskData): Task {
    return Object.assign(Object.create(Task.prototype) as Task, data);
  }

  /** Whether the task is in a terminal state (COMPLETED or ABANDONED) */
  get isTerminal(): boolean {
    return STATUS_TRAITS[this.status].terminal;
  }

  /** Whether the task can be worked on (BACKLOG, READY, or IN_PROGRESS) */
  get isWorkable(): boolean {
    return STATUS_TRAITS[this.status].workable;
  }

  /** Whether work is actively in progress (IN_PROGRESS or PR_REVIEW) */
  get isActive(): boolean {
    return STATUS_TRAITS[this.status].active;
  }

  /** Get the list of statuses this task can transition to */
  get allowedTransitions(): TaskStatus[] {
    return [...VALID_TRANSITIONS[this.status]];
  }

  /**
   * Check if a transition to the given status is allowed.
   *
   * Same-status transitions are considered allowed (no-op).
   */
  checkTransition(toStatus: TaskStatus): TransitionCheck {
    if (this.status === toStatus) {
      return { allowed: true };
    }

    const allowed = VALID_TRANSITIONS[this.status];
    if (allowed.includes(toStatus)) {
      return { allowed: true };
    }

    const allowedStr = allowed.length > 0 ? allowed.join(", ") : "none";
    return {
      allowed: false,
      reason: `Cannot transition from ${this.status} to ${toStatus}. Allowed: [${allowedStr}]`,
    };
  }

  /**
   * Check if the task can be submitted for review.
   *
   * Requires IN_PROGRESS status and a PR URL.
   */
  canSubmitForReview(): TransitionCheck {
    if (this.status !== "IN_PROGRESS") {
      return {
        allowed: false,
        reason: `Cannot submit for review: task is in ${this.status} status. Only IN_PROGRESS tasks can be submitted for review.`,
      };
    }

    if (!this.prUrl) {
      return {
        allowed: false,
        reason: "Cannot submit for review without a PR. Create a PR first using the CLI.",
      };
    }

    return { allowed: true };
  }

  /**
   * Check if the task can be completed.
   *
   * Requires IN_PROGRESS or PR_REVIEW status.
   */
  canComplete(): TransitionCheck {
    if (this.status === "IN_PROGRESS" || this.status === "PR_REVIEW") {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Cannot complete task: task is in ${this.status} status. Only IN_PROGRESS or PR_REVIEW tasks can be completed.`,
    };
  }

  /**
   * Check if the task can be abandoned.
   *
   * Any non-terminal task can be abandoned.
   */
  canAbandon(): TransitionCheck {
    if (this.isTerminal) {
      return {
        allowed: false,
        reason: `Cannot abandon task: task is already in terminal state ${this.status}.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if the task can be deleted (soft delete).
   *
   * Only PLANNED, BACKLOG, or READY tasks can be deleted.
   */
  canDelete(): TransitionCheck {
    if (this.status === "PLANNED" || this.status === "BACKLOG" || this.status === "READY") {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Cannot delete task with status ${this.status}. Only PLANNED, BACKLOG, or READY tasks can be deleted.`,
    };
  }
}

// =============================================================================
// Param Types for TaskRepository
// =============================================================================

/**
 * Parameters for creating a new task.
 *
 * Fields like number, order, createdAt, updatedAt are auto-assigned by the repository.
 */
export interface CreateTaskParams {
  readonly id: string;
  readonly planId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly type: IssueType;
  readonly source: TaskSource;
  readonly acceptanceCriteria: string[];
  readonly isDeleted: boolean;
  readonly estimatedMinutes?: number;
  readonly matchedFromTaskId?: string;
  readonly matchConfidence?: number;
  readonly dependsOn?: string[];
  readonly implementationPlan?: string;
  readonly labels?: Record<string, string>;
  readonly worktreePath?: string;
  readonly branchName?: string;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly prStatus?: PRStatus;
  readonly syncState?: SyncState;
  readonly deletedAt?: string;
  readonly deletedBy?: string;
  readonly sessionId?: string;
  readonly sessionStartedAt?: string;
  readonly lastSessionActivityAt?: string;
  readonly startedAt?: string;
  readonly submittedForReviewAt?: string;
  readonly completedAt?: string;
  readonly abandonedAt?: string;
}

/**
 * Parameters for updating a task.
 *
 * Immutable fields (id, planId, number, order, createdAt, isDeleted) cannot be updated.
 */
export interface UpdateTaskParams {
  readonly title?: string;
  readonly description?: string;
  readonly type?: IssueType;
  readonly acceptanceCriteria?: string[];
  readonly implementationPlan?: string;
  readonly labels?: Record<string, string>;
  readonly updatedAt?: string;
  readonly status?: TaskStatus;
  readonly source?: TaskSource;
  readonly estimatedMinutes?: number;
  readonly matchedFromTaskId?: string;
  readonly matchConfidence?: number;
  readonly dependsOn?: string[];
  readonly deletedAt?: string;
  readonly deletedBy?: string;
  readonly sessionId?: string;
  readonly sessionStartedAt?: string;
  readonly lastSessionActivityAt?: string;
  readonly worktreePath?: string;
  readonly branchName?: string;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly prStatus?: PRStatus;
  readonly syncState?: SyncState;
  readonly startedAt?: string;
  readonly submittedForReviewAt?: string;
  readonly completedAt?: string;
  readonly abandonedAt?: string;
}

// =============================================================================
// Supporting Types
// =============================================================================

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
   * Automatically assigns number, index, and order based on existing tasks for the plan.
   * Caller must provide task id (for dependency tracking).
   *
   * @param task - Task data (without number, index, order, createdAt, updatedAt which are generated)
   * @returns The created task with number, index, order and timestamps assigned
   */
  create(task: CreateTaskParams): Effect<Task>;

  /**
   * Create multiple tasks for a plan (batch operation)
   *
   * More efficient than creating tasks one by one.
   * Automatically assigns sequential number, index, and order values.
   * Caller must provide task ids (for dependency tracking).
   *
   * @param tasks - Array of task data with ids
   * @returns Array of created tasks with numbers, indexes, orders and timestamps assigned
   */
  createMany(tasks: CreateTaskParams[]): Effect<Task[]>;

  /**
   * Find a task by its UUID
   *
   * By default, excludes soft-deleted tasks.
   *
   * @param id - Task UUID
   * @param includeDeleted - Whether to include soft-deleted tasks (default: false)
   * @returns The task if found, null otherwise
   */
  findById(id: string, includeDeleted?: boolean): Effect<Task | null>;

  /**
   * Find multiple tasks by their UUIDs
   *
   * By default, excludes soft-deleted tasks.
   *
   * @param ids - Array of task UUIDs
   * @param includeDeleted - Whether to include soft-deleted tasks (default: false)
   * @returns Array of found tasks (may be fewer than requested if some not found)
   */
  findByIds(ids: string[], includeDeleted?: boolean): Effect<Task[]>;

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
  findByPlanId(planId: string, includeDeleted?: boolean): Effect<Task[]>;

  /**
   * Find all tasks matching filters
   *
   * @param filters - Optional filters for planId, snapshotId, and status
   * @returns Array of matching tasks
   */
  findMany(filters?: TaskFilters): Effect<Task[]>;

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
  updateStatus(id: string, status: TaskStatus, changedBy?: string, notes?: string): Effect<Task>;

  /**
   * Get the next order number for a plan
   *
   * Used internally by create() to assign sequential order numbers.
   *
   * @param planId - Plan UUID
   * @returns The next order number (MAX(order) + 1, or 1 if no tasks exist)
   */
  getNextOrder(planId: string): Effect<number>;

  /**
   * Get the next task number for a plan
   *
   * Used internally by create() to assign sequential task numbers.
   * Task numbers are stable identifiers that don't change when tasks are reordered.
   *
   * @param planId - Plan UUID
   * @returns The next task number (MAX(number) + 1, or 1 if no tasks exist)
   */
  getNextTaskNumber(planId: string): Effect<number>;

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
  ): Effect<Task>;

  /**
   * Clear session association from a task
   *
   * Sets sessionId, sessionStartedAt, and lastSessionActivityAt to undefined.
   * Used when completing or abandoning a session.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearSession(taskId: string): Effect<Task>;

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
  updateWorktreeInfo(taskId: string, worktreePath: string, branchName: string): Effect<Task>;

  /**
   * Clear worktree information from a task
   *
   * Sets worktreePath and branchName to undefined.
   * Used when task is completed or abandoned.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearWorktreeInfo(taskId: string): Effect<Task>;

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
  updatePRInfo(taskId: string, prUrl: string, prNumber: number, prStatus: PRStatus): Effect<Task>;

  /**
   * Update PR status for a task
   *
   * Updates only the prStatus field.
   *
   * @param taskId - Task UUID
   * @param prStatus - New PR status
   * @returns The updated task
   */
  updatePRStatus(taskId: string, prStatus: PRStatus): Effect<Task>;

  /**
   * Clear PR information from a task
   *
   * Sets prUrl, prNumber, and prStatus to undefined.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearPRInfo(taskId: string): Effect<Task>;

  /**
   * Update a task's properties
   *
   * General purpose update method for task fields.
   * Note: `number` is immutable and cannot be updated.
   *
   * @param id - Task UUID
   * @param data - Partial task data to update
   * @returns The updated task
   */
  update(id: string, data: UpdateTaskParams): Effect<Task>;

  /**
   * Update a task's number
   *
   * Used when renumbering tasks during plan regeneration in PLANNED state.
   * Once the issue is activated (moved to OPEN), task numbers should not change.
   *
   * @param id - Task UUID
   * @param newNumber - The new task number
   * @returns The updated task
   */
  updateNumber(id: string, newNumber: number): Effect<Task>;

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
  softDelete(id: string, deletedBy?: string): Effect<Task>;

  /**
   * Restore a soft-deleted task
   *
   * Unmarks the task as deleted.
   *
   * @param id - Task UUID
   * @returns The restored task
   */
  restore(id: string): Effect<Task>;

  /**
   * Update sync state for a task
   *
   * Sets the external issue sync state (ID, URL, node ID, etc.).
   * Called when an external issue is created for the task.
   *
   * @param taskId - Task UUID
   * @param syncState - Sync state to set
   * @returns The updated task
   */
  updateSyncState(taskId: string, syncState: SyncState): Effect<Task>;

  /**
   * Clear sync state from a task
   *
   * Removes external sync state. Used if external issue is deleted.
   *
   * @param taskId - Task UUID
   * @returns The updated task
   */
  clearSyncState(taskId: string): Effect<Task>;

  /**
   * Get status change history for a task
   *
   * Returns all status transitions recorded for this task.
   *
   * @param taskId - Task UUID
   * @returns Array of status history entries
   */
  getStatusHistory(taskId: string): Effect<TaskStatusHistory[]>;

  /**
   * Get execution logs for a task
   *
   * Returns all execution log entries recorded during task execution.
   *
   * @param taskId - Task UUID
   * @returns Array of execution log entries
   */
  getExecutionLogs(taskId: string): Effect<TaskExecutionLog[]>;

  /**
   * Get count of tasks by status
   *
   * @returns Record of status to count
   */
  getStatusCounts(): Effect<Record<string, number>>;
}

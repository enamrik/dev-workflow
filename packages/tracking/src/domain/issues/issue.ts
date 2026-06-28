/**
 * Domain types for Issue entity
 */

import type { Effect } from "@dev-workflow/effect";
import type { SyncState } from "@dev-workflow/database/schema.js";
import type { Task } from "../tasks/task.js";

export type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "CLOSED";

/**
 * Relative weight of each priority — higher means more important.
 *
 * Single source of truth for ordering and scoring by priority. Consumers that
 * rank work (the work queue, auto-claim) read from here rather than hardcoding
 * their own map, so the CRITICAL→HIGH→MEDIUM→LOW ordering lives in one place.
 */
export const PRIORITY_WEIGHTS: Record<IssuePriority, number> = {
  CRITICAL: 40,
  HIGH: 30,
  MEDIUM: 20,
  LOW: 10,
};

/**
 * Comparator ordering priorities most-important-first
 * (CRITICAL → HIGH → MEDIUM → LOW). Use as the primary key in `Array#sort`.
 */
export function comparePriorityDesc(a: IssuePriority, b: IssuePriority): number {
  return PRIORITY_WEIGHTS[b] - PRIORITY_WEIGHTS[a];
}

/**
 * Computed issue status based on task states.
 *
 * This enriches the stored IssueStatus with derived states:
 * - TASKS_DONE: All tasks are terminal but issue not yet closed
 */
export type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

// =============================================================================
// Issue Status Traits (Single Source of Truth)
// =============================================================================

/**
 * Traits for stored IssueStatus - what each stored status means.
 */
const ISSUE_STATUS_TRAITS = {
  PLANNED: { isPlanning: true, isClosed: false },
  OPEN: { isPlanning: false, isClosed: false },
  IN_PROGRESS: { isPlanning: false, isClosed: false },
  CLOSED: { isPlanning: false, isClosed: true },
} as const satisfies Record<IssueStatus, { isPlanning: boolean; isClosed: boolean }>;

/**
 * Traits for ComputedIssueStatus - semantic meaning of computed states.
 *
 * This is the stable contract for what computed statuses mean.
 * Implementation (computed vs stored) is hidden from consumers.
 */
const COMPUTED_ISSUE_STATUS_TRAITS = {
  PLANNED: { done: false, hasActiveWork: false },
  OPEN: { done: false, hasActiveWork: false },
  IN_PROGRESS: { done: false, hasActiveWork: true },
  TASKS_DONE: { done: true, hasActiveWork: false },
  CLOSED: { done: true, hasActiveWork: false },
} as const satisfies Record<ComputedIssueStatus, { done: boolean; hasActiveWork: boolean }>;

// =============================================================================
// Computed Status (Implementation Detail - Hidden from Consumers)
// =============================================================================

/**
 * Compute the effective issue status from stored status and tasks.
 *
 * PRIVATE: This is the ONE PLACE that changes when we switch from
 * computed to stored IN_PROGRESS/TASKS_DONE.
 *
 * @internal
 */
function getEffectiveIssueStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
  // Check stored status traits first
  if (ISSUE_STATUS_TRAITS[issue.status].isPlanning) return "PLANNED";
  if (ISSUE_STATUS_TRAITS[issue.status].isClosed) return "CLOSED";

  // Derive from tasks
  if (tasks.length === 0) return "OPEN";
  if (Issue.allTerminal(tasks)) return "TASKS_DONE";
  if (Issue.anyActive(tasks)) return "IN_PROGRESS";
  return "OPEN";
}

// =============================================================================
// Issue Interface (data shape)
// =============================================================================

/**
 * Issue entity
 *
 * Represents a trackable work item (feature, bug, enhancement, or task)
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Issue {
  id: string;
  /** Project identifier (e.g., "dev-workflow-abc123") */
  projectId: string;
  number: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  templateUsed?: string;
  createdBy?: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string

  /** External sync state (optional - only present if synced to external system) */
  syncState?: SyncState;

  /** Milestone this issue belongs to (optional) */
  milestoneId?: string;

  /**
   * Source external issue ID for imported issues.
   * When an issue is imported from an existing external issue, this stores
   * the original external issue ID. This is different from syncState
   * which tracks the external issue created BY dev-workflow for syncing.
   */
  sourceExternalId?: string;

  /**
   * Labels - unified metadata for issues and tasks.
   * Supports both simple labels (empty value) and key-value pairs.
   * Example: { "bug": "", "product": "Case Workflow", "Product Area": "HR Portal" }
   */
  labels?: Record<string, string>;

  /** Soft delete fields */
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

// =============================================================================
// Issue Data Type (plain data shape without class methods)
// =============================================================================

/**
 * Plain data shape for Issue — the interface fields only, without class methods.
 *
 * Use this type when constructing Issue data (e.g., in mappers, tests).
 * Pass to `Issue.from()` to get a full Issue instance with domain methods.
 */
export interface IssueData {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  templateUsed?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  syncState?: SyncState;
  milestoneId?: string;
  sourceExternalId?: string;
  labels?: Record<string, string>;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

// =============================================================================
// Issue Class (declaration-merged with interface above)
// =============================================================================

/**
 * Result of checking whether an issue can be closed.
 */
export interface CloseCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Issue domain class — declaration-merged with the Issue interface.
 *
 * Provides domain methods for issue operations. Use `Issue.from()` to
 * hydrate plain data objects into class instances.
 */

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Issue {
  /**
   * Hydrate a plain data object into an Issue class instance.
   *
   * Uses Object.create + Object.assign so that the result is both
   * an `instanceof Issue` and carries all data fields from the interface.
   */
  static from(data: IssueData): Issue {
    return Object.assign(Object.create(Issue.prototype) as Issue, data);
  }

  // ---------------------------------------------------------------------------
  // Instance getters (stored-status traits)
  // ---------------------------------------------------------------------------

  /** Whether the issue is closed. */
  get isClosed(): boolean {
    return ISSUE_STATUS_TRAITS[this.status].isClosed;
  }

  /** Whether the issue is in the planning phase (not yet moved to backlog). */
  get isInPlanning(): boolean {
    return ISSUE_STATUS_TRAITS[this.status].isPlanning;
  }

  // ---------------------------------------------------------------------------
  // Static methods (cross-aggregate — need Task[] from another aggregate)
  // ---------------------------------------------------------------------------

  /**
   * Check if all tasks are in a terminal state (COMPLETED or ABANDONED).
   */
  static allTerminal(tasks: Task[]): boolean {
    return tasks.length > 0 && tasks.every((t) => t.isTerminal);
  }

  /**
   * Check if any task has active work (IN_PROGRESS or PR_REVIEW).
   */
  static anyActive(tasks: Task[]): boolean {
    return tasks.some((t) => t.isActive);
  }

  /**
   * Compute the effective issue status from stored status and tasks.
   *
   * Returns the enriched ComputedIssueStatus that accounts for task states.
   */
  static computeStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
    return getEffectiveIssueStatus(issue, tasks);
  }

  /**
   * Whether a computed status represents a "done" issue — one with no active
   * or available work left. True for TASKS_DONE (all tasks terminal, issue not
   * yet closed) and CLOSED. Reads the computed-status trait table so the
   * meaning of "done" stays in one place; consumers that already computed the
   * status (work queue, board ribbon) pass it in rather than recomputing.
   */
  static isDoneStatus(status: ComputedIssueStatus): boolean {
    return COMPUTED_ISSUE_STATUS_TRAITS[status].done;
  }

  // ---------------------------------------------------------------------------
  // Instance methods (need cross-aggregate data passed in)
  // ---------------------------------------------------------------------------

  /**
   * Check whether this issue can be closed, returning a structured result.
   *
   * @param tasks - Tasks belonging to this issue
   * @param force - If true, allow closing even if tasks are incomplete
   */
  checkCanClose(tasks: Task[], force: boolean): CloseCheck {
    if (this.isClosed) {
      return { allowed: false, reason: "Issue is already closed" };
    }
    if (!force && tasks.length > 0 && !Issue.allTerminal(tasks)) {
      return {
        allowed: false,
        reason: "Issue has incomplete tasks. Use force=true to close anyway.",
      };
    }
    return { allowed: true };
  }
}

// =============================================================================
// Deprecated Free Functions (wrapper delegates — remove in Phase 4)
// =============================================================================

/**
 * @deprecated Use `issue.isClosed` instead
 */
export function isIssueClosed(issue: Issue): boolean {
  return issue.isClosed;
}

/**
 * @deprecated Use `issue.isInPlanning` instead
 */
export function isIssueInPlanning(issue: Issue): boolean {
  return issue.isInPlanning;
}

/**
 * @deprecated Use `Issue.allTerminal(tasks)` instead
 */
export function allTasksTerminal(tasks: Task[]): boolean {
  return Issue.allTerminal(tasks);
}

/**
 * @deprecated Use `Issue.anyActive(tasks)` instead
 */
export function anyTaskActive(tasks: Task[]): boolean {
  return Issue.anyActive(tasks);
}

/**
 * @deprecated Use `Issue.computeStatus()` instead
 */
export function computeIssueStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
  return Issue.computeStatus(issue, tasks);
}

/**
 * @deprecated Use `Issue.computeStatus()` and check the computed traits instead
 */
export function isIssueDone(issue: Issue, tasks: Task[]): boolean {
  return COMPUTED_ISSUE_STATUS_TRAITS[getEffectiveIssueStatus(issue, tasks)].done;
}

/**
 * @deprecated Use `Issue.computeStatus()` and check the computed traits instead
 */
export function issueHasActiveWork(issue: Issue, tasks: Task[]): boolean {
  return COMPUTED_ISSUE_STATUS_TRAITS[getEffectiveIssueStatus(issue, tasks)].hasActiveWork;
}

// =============================================================================
// Param Types for Repository Operations
// =============================================================================

/**
 * Parameters for creating a new issue.
 *
 * Fields like id, number, projectId, createdAt, updatedAt are generated
 * by the repository and should not be provided.
 */
export interface CreateIssueParams {
  readonly title: string;
  readonly description: string;
  readonly type: IssueType;
  readonly priority: IssuePriority;
  readonly status: IssueStatus;
  readonly acceptanceCriteria: string[];
  readonly templateUsed?: string;
  readonly createdBy?: string;
  readonly syncState?: SyncState;
  readonly milestoneId?: string;
  readonly sourceExternalId?: string;
  readonly labels?: Record<string, string>;
  readonly isDeleted?: boolean;
  readonly deletedAt?: string;
  readonly deletedBy?: string;
}

/**
 * Parameters for updating an existing issue.
 *
 * All fields are optional — only provided fields will be updated.
 * Fields like id, number, and createdAt are immutable and cannot be updated.
 */
export interface UpdateIssueParams {
  readonly title?: string;
  readonly description?: string;
  readonly type?: IssueType;
  readonly priority?: IssuePriority;
  readonly status?: IssueStatus;
  readonly acceptanceCriteria?: string[];
  readonly templateUsed?: string;
  readonly createdBy?: string;
  readonly syncState?: SyncState;
  readonly milestoneId?: string;
  readonly sourceExternalId?: string;
  readonly labels?: Record<string, string>;
  readonly projectId?: string;
  readonly updatedAt?: string;
  readonly isDeleted?: boolean;
  readonly deletedAt?: string;
  readonly deletedBy?: string;
}

// =============================================================================
// Query Filters
// =============================================================================

/**
 * Filters for querying issues
 */
export interface IssueFilters {
  status?: IssueStatus;
  /** Exclude issues with these statuses */
  excludeStatuses?: IssueStatus[];
  type?: IssueType;
  /** Filter by milestone */
  milestoneId?: string;
  /** Include soft-deleted issues in results (default: false) */
  includeDeleted?: boolean;
}

// =============================================================================
// Repository Interface
// =============================================================================

/**
 * Repository interface for Issue persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 *
 * Implementations are scoped to a specific project.
 */
export interface IssueRepository {
  /**
   * Create a new issue
   *
   * @param issue - Issue data (without id, number, projectId, createdAt, updatedAt which are generated)
   * @returns The created issue with id, number, projectId, and timestamps assigned
   */
  create(issue: CreateIssueParams): Effect<Issue>;

  /**
   * Find an issue by its UUID
   *
   * By default, excludes soft-deleted issues.
   *
   * @param id - Issue UUID
   * @param includeDeleted - Whether to include soft-deleted issues (default: false)
   * @returns The issue if found, null otherwise
   */
  findById(id: string, includeDeleted?: boolean): Effect<Issue | null>;

  /**
   * Find an issue by its number (e.g., #123)
   *
   * By default, excludes soft-deleted issues.
   *
   * @param number - Issue number
   * @param includeDeleted - Whether to include soft-deleted issues (default: false)
   * @returns The issue if found, null otherwise
   */
  findByNumber(number: number, includeDeleted?: boolean): Effect<Issue | null>;

  /**
   * Find all issues matching the given filters
   *
   * @param filters - Optional filters for status and type
   * @returns Array of matching issues
   */
  findMany(filters?: IssueFilters): Effect<Issue[]>;

  /**
   * Get the next available issue number
   *
   * Used internally by create() to assign sequential issue numbers.
   *
   * @returns The next issue number (MAX(number) + 1)
   */
  getNextIssueNumber(): Effect<number>;

  /**
   * Update an existing issue
   *
   * @param id - Issue UUID
   * @param data - Partial issue data to update (cannot update id, number, or createdAt)
   * @returns The updated issue
   */
  update(id: string, data: UpdateIssueParams): Effect<Issue>;

  /**
   * Soft delete an issue
   *
   * Sets isDeleted=true and records deletion metadata.
   * The issue will be excluded from findMany() by default.
   *
   * @param id - Issue UUID
   * @param deletedBy - Who performed the deletion (e.g., "claude-code")
   * @returns The deleted issue
   */
  delete(id: string, deletedBy: string): Effect<Issue>;

  /**
   * Restore a soft-deleted issue
   *
   * Clears isDeleted flag and deletion metadata.
   *
   * @param id - Issue UUID
   * @returns The restored issue
   */
  restore(id: string): Effect<Issue>;

  /**
   * Search issues by keyword in title or description
   *
   * Case-insensitive search, limited to 10 results.
   *
   * @param query - Search query string
   * @returns Array of matching issues (slim version)
   */
  search(
    query: string
  ): Effect<Pick<Issue, "id" | "number" | "title" | "status" | "type" | "priority">[]>;

  /**
   * Get count of issues by status
   *
   * @returns Record of status to count
   */
  getStatusCounts(): Effect<Record<string, number>>;
}

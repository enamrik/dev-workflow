/**
 * Domain types for Issue entity
 */

import type { GitHubSyncState } from "./github.js";
import type { Task } from "./task.js";
import { isTerminal as isTaskTerminal, isActive as isTaskActive } from "./task.js";

export type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "CLOSED";

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
// Task Aggregate Helpers
// =============================================================================

/**
 * Check if all tasks are in terminal state (COMPLETED or ABANDONED).
 * Use for determining if an issue's work is complete.
 */
export function allTasksTerminal(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every(isTaskTerminal);
}

/**
 * Check if any task has active work (IN_PROGRESS or PR_REVIEW).
 * Use for determining if an issue has work in progress.
 */
export function anyTaskActive(tasks: Task[]): boolean {
  return tasks.some(isTaskActive);
}

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
  if (allTasksTerminal(tasks)) return "TASKS_DONE";
  if (anyTaskActive(tasks)) return "IN_PROGRESS";
  return "OPEN";
}

// =============================================================================
// Public Trait Functions (Stable API)
// =============================================================================

/**
 * Check if an issue is in the planning phase (not yet moved to backlog).
 *
 * @param issue - Issue to check
 * @returns true if issue is still being planned
 */
export function isIssueInPlanning(issue: Issue): boolean {
  return ISSUE_STATUS_TRAITS[issue.status].isPlanning;
}

/**
 * Check if an issue is closed.
 *
 * @param issue - Issue to check
 * @returns true if issue is closed
 */
export function isIssueClosed(issue: Issue): boolean {
  return ISSUE_STATUS_TRAITS[issue.status].isClosed;
}

/**
 * Check if an issue is done (all tasks terminal or issue closed).
 *
 * This hides whether "done" is stored or computed from tasks.
 * When we later add stored TASKS_DONE status, only getEffectiveIssueStatus changes.
 *
 * @param issue - Issue to check
 * @param tasks - Tasks for this issue
 * @returns true if issue is done
 */
export function isIssueDone(issue: Issue, tasks: Task[]): boolean {
  return COMPUTED_ISSUE_STATUS_TRAITS[getEffectiveIssueStatus(issue, tasks)].done;
}

/**
 * Check if an issue has active work in progress.
 *
 * This hides whether "active work" is stored or computed from tasks.
 * When we later add stored IN_PROGRESS status, only getEffectiveIssueStatus changes.
 *
 * @param issue - Issue to check
 * @param tasks - Tasks for this issue
 * @returns true if issue has active work
 */
export function issueHasActiveWork(issue: Issue, tasks: Task[]): boolean {
  return COMPUTED_ISSUE_STATUS_TRAITS[getEffectiveIssueStatus(issue, tasks)].hasActiveWork;
}

/**
 * Compute the issue status for display purposes.
 *
 * Returns the effective status (stored or computed) as a ComputedIssueStatus value.
 * Use trait functions (isIssueDone, issueHasActiveWork) for semantic checks.
 *
 * @param issue - Issue to compute status for
 * @param tasks - Tasks for this issue
 * @returns The computed status value
 */
export function computeIssueStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
  return getEffectiveIssueStatus(issue, tasks);
}

/**
 * Issue entity
 *
 * Represents a trackable work item (feature, bug, enhancement, or task)
 */
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

  /** GitHub sync state (optional - only present if synced to GitHub) */
  githubSync?: GitHubSyncState;

  /** Milestone this issue belongs to (optional) */
  milestoneId?: string;

  /**
   * Source GitHub issue number for imported issues.
   * When an issue is imported from an existing GitHub issue, this stores
   * the original GitHub issue number. This is different from githubSync
   * which tracks the GitHub issue created BY dev-workflow for syncing.
   */
  sourceGitHubIssueNumber?: number;

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
  create(issue: Omit<Issue, "id" | "number" | "projectId" | "createdAt" | "updatedAt">): Issue;

  /**
   * Find an issue by its UUID
   *
   * By default, excludes soft-deleted issues.
   *
   * @param id - Issue UUID
   * @param includeDeleted - Whether to include soft-deleted issues (default: false)
   * @returns The issue if found, null otherwise
   */
  findById(id: string, includeDeleted?: boolean): Issue | null;

  /**
   * Find an issue by its number (e.g., #123)
   *
   * By default, excludes soft-deleted issues.
   *
   * @param number - Issue number
   * @param includeDeleted - Whether to include soft-deleted issues (default: false)
   * @returns The issue if found, null otherwise
   */
  findByNumber(number: number, includeDeleted?: boolean): Issue | null;

  /**
   * Find all issues matching the given filters
   *
   * @param filters - Optional filters for status and type
   * @returns Array of matching issues
   */
  findMany(filters?: IssueFilters): Issue[];

  /**
   * Get the next available issue number
   *
   * Used internally by create() to assign sequential issue numbers.
   *
   * @returns The next issue number (MAX(number) + 1)
   */
  getNextIssueNumber(): number;

  /**
   * Update an existing issue
   *
   * @param id - Issue UUID
   * @param data - Partial issue data to update (cannot update id, number, or createdAt)
   * @returns The updated issue
   */
  update(id: string, data: Partial<Omit<Issue, "id" | "number" | "createdAt">>): Issue;

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
  delete(id: string, deletedBy: string): Issue;

  /**
   * Restore a soft-deleted issue
   *
   * Clears isDeleted flag and deletion metadata.
   *
   * @param id - Issue UUID
   * @returns The restored issue
   */
  restore(id: string): Issue;

  /**
   * Search issues by keyword in title or description
   *
   * Case-insensitive search, limited to 10 results.
   *
   * @param query - Search query string
   * @returns Array of matching issues (slim version)
   */
  search(query: string): Pick<Issue, "id" | "number" | "title" | "status" | "type" | "priority">[];

  /**
   * Get count of issues by status
   *
   * @returns Record of status to count
   */
  getStatusCounts(): Record<string, number>;
}

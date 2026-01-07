/**
 * Domain types for Issue entity
 */

import type { GitHubSyncState } from "./github.js";

export type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "CLOSED";

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
   * @param id - Issue UUID
   * @returns The issue if found, null otherwise
   */
  findById(id: string): Issue | null;

  /**
   * Find an issue by its number (e.g., #123)
   *
   * @param number - Issue number
   * @returns The issue if found, null otherwise
   */
  findByNumber(number: number): Issue | null;

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
}

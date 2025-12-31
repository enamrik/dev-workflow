/**
 * Domain types for Issue entity
 */

export type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

/**
 * Issue entity
 *
 * Represents a trackable work item (feature, bug, enhancement, or task)
 */
export interface Issue {
  id: string;
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
}

/**
 * Filters for querying issues
 */
export interface IssueFilters {
  status?: IssueStatus;
  type?: IssueType;
}

/**
 * Repository interface for Issue persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 */
export interface IssueRepository {
  /**
   * Create a new issue
   *
   * @param issue - Issue data (without id, number, createdAt, updatedAt which are generated)
   * @returns The created issue with id, number, and timestamps assigned
   */
  create(issue: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt">): Issue;

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
  update(
    id: string,
    data: Partial<Omit<Issue, "id" | "number" | "createdAt">>
  ): Issue;
}

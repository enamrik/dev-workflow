/**
 * Domain types for Milestone entity
 */

export type MilestoneStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";

/**
 * Milestone entity
 *
 * Represents a time-bounded collection of issues.
 * Milestones have start and end dates and are displayed on a timeline.
 *
 * Status is computed at read time based on issue states and dates:
 * - COMPLETED: Stored value (requires manual sign-off via update_milestone)
 * - DELAYED: endDate < today AND not all issues closed AND not COMPLETED
 * - IN_PROGRESS: At least one issue is OPEN or IN_PROGRESS
 * - PLANNED: All issues are PLANNED or no issues assigned
 */
export interface Milestone {
  readonly id: string; // UUID
  readonly projectId: string; // Project identifier
  readonly number: number; // Sequential number per project (M1, M2, etc.)
  readonly title: string;
  readonly description: string;
  readonly startDate: string; // ISO date YYYY-MM-DD
  readonly endDate: string; // ISO date YYYY-MM-DD
  readonly status: MilestoneStatus;
  readonly createdAt: string; // ISO datetime string
  readonly updatedAt: string; // ISO datetime string
}

/**
 * Issue status data needed for milestone status computation
 */
export interface MilestoneIssueStats {
  /** Total number of issues in the milestone */
  readonly totalIssues: number;
  /** Number of issues with CLOSED status */
  readonly closedIssues: number;
  /** Number of issues with OPEN or IN_PROGRESS status (work started) */
  readonly openOrInProgressIssues: number;
}

/**
 * Compute milestone status from stored status, issue stats, and dates.
 *
 * Status priority (highest to lowest):
 * 1. COMPLETED - stored value (manual sign-off), never overridden
 * 2. DELAYED - past endDate AND not all issues closed
 * 3. IN_PROGRESS - at least one issue has work started
 * 4. PLANNED - all issues are in PLANNED state or no issues assigned
 *
 * @param storedStatus - The status stored in the database
 * @param issueStats - Issue statistics for the milestone
 * @param endDate - Milestone end date (YYYY-MM-DD format)
 * @param today - Today's date (YYYY-MM-DD format, for testing)
 * @returns Computed milestone status
 */
export function computeMilestoneStatus(
  storedStatus: MilestoneStatus,
  issueStats: MilestoneIssueStats,
  endDate: string,
  today: string = new Date().toISOString().split("T")[0] ?? ""
): MilestoneStatus {
  // COMPLETED is a manual action - never override
  if (storedStatus === "COMPLETED") {
    return "COMPLETED";
  }

  const { totalIssues, closedIssues, openOrInProgressIssues } = issueStats;

  // Check for DELAYED: past endDate AND not all issues closed
  const isPastEndDate = today > endDate;
  const allIssuesClosed = totalIssues > 0 && closedIssues === totalIssues;

  if (isPastEndDate && !allIssuesClosed) {
    return "DELAYED";
  }

  // Check for IN_PROGRESS: at least one issue has work started
  if (openOrInProgressIssues > 0) {
    return "IN_PROGRESS";
  }

  // Default: PLANNED (all issues in PLANNED state or no issues)
  return "PLANNED";
}

/**
 * Filters for querying milestones
 */
export interface MilestoneFilters {
  status?: MilestoneStatus;
}

/**
 * Repository interface for Milestone persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 */
export interface MilestoneRepository {
  /**
   * Create a new milestone
   *
   * Automatically assigns number based on existing milestones for the project.
   *
   * @param milestone - Milestone data (without id, projectId, number, createdAt, updatedAt which are generated)
   * @returns The created milestone with id, projectId, number, and timestamps assigned
   */
  create(
    milestone: Omit<Milestone, "id" | "projectId" | "number" | "createdAt" | "updatedAt">
  ): Milestone;

  /**
   * Find a milestone by its UUID
   *
   * @param id - Milestone UUID
   * @returns The milestone if found, null otherwise
   */
  findById(id: string): Milestone | null;

  /**
   * Find a milestone by its number
   *
   * @param number - Milestone number (e.g., 1 for M1)
   * @returns The milestone if found, null otherwise
   */
  findByNumber(number: number): Milestone | null;

  /**
   * Find all milestones matching filters
   *
   * Returns milestones ordered by startDate ASC.
   *
   * @param filters - Optional filters for status
   * @returns Array of matching milestones
   */
  findMany(filters?: MilestoneFilters): Milestone[];

  /**
   * Get the next milestone number for the project
   *
   * Used internally by create() to assign sequential milestone numbers.
   *
   * @returns The next milestone number (MAX(number) + 1, or 1 if no milestones exist)
   */
  getNextMilestoneNumber(): number;

  /**
   * Update a milestone's properties
   *
   * @param id - Milestone UUID
   * @param data - Partial milestone data to update
   * @returns The updated milestone
   */
  update(
    id: string,
    data: Partial<Omit<Milestone, "id" | "projectId" | "number" | "createdAt">>
  ): Milestone;

  /**
   * Delete a milestone
   *
   * Issues assigned to this milestone will have their milestoneId set to null.
   *
   * @param id - Milestone UUID
   */
  delete(id: string): void;
}

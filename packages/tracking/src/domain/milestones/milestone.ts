/**
 * Domain types for Milestone entity
 */

import type { Effect } from "@dev-workflow/effect";
import type { Issue } from "../issues/issue.js";

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
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Milestone {
  readonly id: string; // UUID
  readonly number: number; // Sequential number, globally unique across all projects (M1, M2, etc.)
  readonly title: string;
  readonly description: string;
  readonly startDate: string; // ISO date YYYY-MM-DD
  readonly endDate: string; // ISO date YYYY-MM-DD
  readonly status: MilestoneStatus;
  readonly createdAt: string; // ISO datetime string
  readonly updatedAt: string; // ISO datetime string
}

// =============================================================================
// Milestone Class (declaration-merged with interface above)
// =============================================================================

/**
 * Result of a date or status validation check.
 */
export interface DateValidation {
  readonly valid: boolean;
  readonly reason?: string;
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
 * Milestone domain class -- declaration-merged with the Milestone interface.
 *
 * Provides static domain methods for milestone operations. Use `Milestone.from()` to
 * hydrate plain data objects into class instances.
 */

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Milestone {
  /**
   * Hydrate a plain data object into a Milestone class instance.
   *
   * Uses Object.create + Object.assign so that the result is both
   * an `instanceof Milestone` and carries all data fields from the interface.
   */
  static from(data: Milestone): Milestone {
    return Object.assign(Object.create(Milestone.prototype) as Milestone, data);
  }

  /**
   * Compute milestone status from stored status, issue stats, and dates.
   *
   * Status priority (highest to lowest):
   * 1. COMPLETED - stored value (manual sign-off), never overridden
   * 2. DELAYED - past endDate AND not all issues closed
   * 3. IN_PROGRESS - at least one issue has work started
   * 4. PLANNED - all issues are in PLANNED state or no issues assigned
   */
  static computeStatus(
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
   * Validate that a date string is in YYYY-MM-DD format.
   */
  static validateDate(date: string, fieldName: string): DateValidation {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return { valid: false, reason: `${fieldName} must be in YYYY-MM-DD format` };
    }
    return { valid: true };
  }

  /**
   * Validate that startDate is before or equal to endDate.
   */
  static validateDateRange(startDate: string, endDate: string): DateValidation {
    if (startDate > endDate) {
      return { valid: false, reason: "startDate must be before or equal to endDate" };
    }
    return { valid: true };
  }

  /**
   * Validate that a status can be set manually.
   * Only COMPLETED can be set manually; other statuses are computed.
   */
  static canSetStatus(newStatus: MilestoneStatus): DateValidation {
    if (newStatus !== "COMPLETED") {
      return {
        valid: false,
        reason: `Cannot set status to ${newStatus}. Only COMPLETED can be set manually.`,
      };
    }
    return { valid: true };
  }
}

/**
 * Filters for querying milestones
 */
export interface MilestoneFilters {
  status?: MilestoneStatus;
}

// =============================================================================
// Param Types for MilestoneRepository
// =============================================================================

export interface CreateMilestoneParams {
  readonly title: string;
  readonly description: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: MilestoneStatus;
}

export interface UpdateMilestoneParams {
  readonly title?: string;
  readonly description?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly status?: MilestoneStatus;
  readonly updatedAt?: string;
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
   * Automatically assigns a globally-unique number based on existing milestones.
   *
   * @param milestone - Milestone data (without id, number, createdAt, updatedAt which are generated)
   * @returns The created milestone with id, number, and timestamps assigned
   */
  create(milestone: CreateMilestoneParams): Effect<Milestone>;

  /**
   * Find a milestone by its UUID
   *
   * @param id - Milestone UUID
   * @returns The milestone if found, null otherwise
   */
  findById(id: string): Effect<Milestone | null>;

  /**
   * Find a milestone by its number
   *
   * @param number - Milestone number (e.g., 1 for M1)
   * @returns The milestone if found, null otherwise
   */
  findByNumber(number: number): Effect<Milestone | null>;

  /**
   * Find all milestones matching filters
   *
   * Returns milestones ordered by startDate ASC.
   *
   * @param filters - Optional filters for status
   * @returns Array of matching milestones
   */
  findMany(filters?: MilestoneFilters): Effect<Milestone[]>;

  /**
   * Get the next globally-unique milestone number.
   *
   * Used internally by create() to assign sequential milestone numbers across
   * all projects.
   *
   * @returns The next milestone number (MAX(number) + 1, or 1 if no milestones exist)
   */
  getNextMilestoneNumber(): Effect<number>;

  /**
   * Update a milestone's properties
   *
   * @param id - Milestone UUID
   * @param data - Partial milestone data to update
   * @returns The updated milestone
   */
  update(id: string, data: UpdateMilestoneParams): Effect<Milestone>;

  /**
   * Delete a milestone
   *
   * Issues assigned to this milestone will have their milestoneId set to null.
   *
   * @param id - Milestone UUID
   */
  delete(id: string): Effect<void>;
}

// =============================================================================
// MilestoneIssueGateway
// =============================================================================

/**
 * An issue assigned to a milestone, tagged with the project that owns it.
 *
 * Milestones are global and can group issues from any project, so callers need
 * the owning project's slug/name to render cross-project links and labels.
 */
export interface MilestoneIssue {
  readonly issue: Issue;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly projectName: string;
}

/**
 * Cross-project issue port for milestones.
 *
 * Milestones live globally but their issue membership spans every project, so
 * the milestone domain cannot use a project-scoped IssueRepository. This gateway
 * is the narrow set of cross-project issue operations a milestone needs: read
 * all member issues (with project context) and write a single issue's milestone
 * link. It is implemented by the global DbSource, which holds the shared db.
 */
export interface MilestoneIssueGateway {
  /**
   * Find every (non-deleted) issue assigned to a milestone, across all projects,
   * each tagged with its owning project's id/slug/name.
   */
  findIssuesByMilestoneId(milestoneId: string): Effect<MilestoneIssue[]>;

  /**
   * Clear the milestone association from every issue assigned to it, across all
   * projects (UPDATE issues SET milestone_id = NULL WHERE milestone_id = ?).
   *
   * @returns The number of issues that were unassigned
   */
  clearMilestoneFromIssues(milestoneId: string): Effect<number>;

  /**
   * Set (or clear, when null) the milestone link on a single issue, regardless
   * of which project owns it.
   */
  setIssueMilestone(issueId: string, milestoneId: string | null): Effect<void>;
}

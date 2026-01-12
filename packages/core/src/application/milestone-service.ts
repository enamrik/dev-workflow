/**
 * MilestoneService - Application service for milestone operations
 *
 * Orchestrates milestone operations including issue assignment.
 * All milestone mutations should go through this service to ensure
 * consistent behavior across MCP tools, web API, and CLI.
 *
 * Follows Service Layer Pattern:
 * - Orchestrates multi-step operations
 * - Uses repositories for data access
 *
 * Note: Milestones don't sync to external providers. Status is computed
 * at read time based on issue states and dates.
 */

import type {
  Milestone,
  MilestoneStatus,
  MilestoneIssueStats,
  MilestoneRepository,
} from "../domain/milestone.js";
import { computeMilestoneStatus } from "../domain/milestone.js";
import type { DbClient } from "../domain/db-client.js";

/**
 * Error thrown when milestone operation fails
 */
export class MilestoneServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INVALID_STATUS" | "INVALID_DATE" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "MilestoneServiceError";
  }
}

/**
 * Milestone with computed status
 */
export interface MilestoneWithStatus extends Milestone {
  readonly computedStatus: MilestoneStatus;
  readonly issueStats: MilestoneIssueStats;
}

/**
 * MilestoneService - Orchestrates milestone operations
 */
export class MilestoneService {
  constructor(private readonly db: DbClient) {}

  // ============================================================================
  // Read Operations (delegating to repository)
  // ============================================================================

  /**
   * Find a milestone by ID
   *
   * @returns Milestone or null if not found
   */
  findById(milestoneId: string): Milestone | null {
    return this.db.milestones.findById(milestoneId);
  }

  /**
   * Find a milestone by number
   *
   * @returns Milestone or null if not found
   */
  findByNumber(number: number): Milestone | null {
    return this.db.milestones.findByNumber(number);
  }

  /**
   * Find many milestones
   */
  findMany(): Milestone[] {
    return this.db.milestones.findMany();
  }

  /**
   * Create a milestone (direct repository call, for simpler handlers)
   * For validation, use createMilestone().
   */
  create(data: Parameters<MilestoneRepository["create"]>[0]): Milestone {
    return this.db.milestones.create(data);
  }

  /**
   * Update a milestone (direct repository call, for simpler handlers)
   * For validation, use updateMilestone().
   */
  update(milestoneId: string, updates: Parameters<MilestoneRepository["update"]>[1]): Milestone {
    return this.db.milestones.update(milestoneId, updates);
  }

  /**
   * Delete a milestone (direct repository call)
   * For unassigning issues, use deleteMilestone().
   */
  delete(milestoneId: string): void {
    this.db.milestones.delete(milestoneId);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Compute issue stats for a milestone
   */
  private computeIssueStats(milestoneId: string): MilestoneIssueStats {
    const issues = this.db.issues.findMany({ milestoneId });

    return {
      totalIssues: issues.length,
      closedIssues: issues.filter((i) => i.status === "CLOSED").length,
      openOrInProgressIssues: issues.filter(
        (i) => i.status === "OPEN" || i.status === "IN_PROGRESS"
      ).length,
    };
  }

  /**
   * Get a milestone with computed status
   */
  private withComputedStatus(milestone: Milestone): MilestoneWithStatus {
    const issueStats = this.computeIssueStats(milestone.id);
    const computedStatus = computeMilestoneStatus(milestone.status, issueStats, milestone.endDate);

    return {
      ...milestone,
      computedStatus,
      issueStats,
    };
  }

  /**
   * Get a milestone by ID
   *
   * @throws MilestoneServiceError if milestone not found
   */
  getMilestone(milestoneId: string): MilestoneWithStatus {
    const milestone = this.db.milestones.findById(milestoneId);
    if (!milestone) {
      throw new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND");
    }
    return this.withComputedStatus(milestone);
  }

  /**
   * Get a milestone by number
   *
   * @throws MilestoneServiceError if milestone not found
   */
  getMilestoneByNumber(number: number): MilestoneWithStatus {
    const milestone = this.db.milestones.findByNumber(number);
    if (!milestone) {
      throw new MilestoneServiceError(`Milestone M${number} not found`, "NOT_FOUND");
    }
    return this.withComputedStatus(milestone);
  }

  /**
   * Create a new milestone
   *
   * @param data - Milestone data
   * @returns The created milestone with computed status
   */
  createMilestone(data: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
  }): MilestoneWithStatus {
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.startDate)) {
      throw new MilestoneServiceError("startDate must be in YYYY-MM-DD format", "INVALID_DATE");
    }
    if (!dateRegex.test(data.endDate)) {
      throw new MilestoneServiceError("endDate must be in YYYY-MM-DD format", "INVALID_DATE");
    }

    // Validate date range
    if (data.startDate > data.endDate) {
      throw new MilestoneServiceError(
        "startDate must be before or equal to endDate",
        "INVALID_DATE"
      );
    }

    const milestone = this.db.milestones.create({
      title: data.title,
      description: data.description ?? "",
      startDate: data.startDate,
      endDate: data.endDate,
      status: "PLANNED",
    });

    return this.withComputedStatus(milestone);
  }

  /**
   * Update a milestone
   *
   * Status can only be set to COMPLETED (manual sign-off).
   * Other statuses are computed from issue states.
   *
   * @param milestoneId - Milestone UUID
   * @param updates - Fields to update
   * @returns The updated milestone with computed status
   */
  updateMilestone(
    milestoneId: string,
    updates: {
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      status?: MilestoneStatus;
    }
  ): MilestoneWithStatus {
    const milestone = this.db.milestones.findById(milestoneId);
    if (!milestone) {
      throw new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND");
    }

    // Validate status update
    if (updates.status && updates.status !== "COMPLETED") {
      throw new MilestoneServiceError(
        `Cannot set status to ${updates.status}. Only COMPLETED can be set manually.`,
        "INVALID_STATUS"
      );
    }

    // Validate date format if provided
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (updates.startDate && !dateRegex.test(updates.startDate)) {
      throw new MilestoneServiceError("startDate must be in YYYY-MM-DD format", "INVALID_DATE");
    }
    if (updates.endDate && !dateRegex.test(updates.endDate)) {
      throw new MilestoneServiceError("endDate must be in YYYY-MM-DD format", "INVALID_DATE");
    }

    // Validate date range
    const newStartDate = updates.startDate ?? milestone.startDate;
    const newEndDate = updates.endDate ?? milestone.endDate;
    if (newStartDate > newEndDate) {
      throw new MilestoneServiceError(
        "startDate must be before or equal to endDate",
        "INVALID_DATE"
      );
    }

    const updated = this.db.milestones.update(milestoneId, updates);
    return this.withComputedStatus(updated);
  }

  /**
   * Delete a milestone
   *
   * Unassigns all issues from the milestone before deleting.
   *
   * @param milestoneId - Milestone UUID
   * @returns Number of issues that were unassigned
   */
  deleteMilestone(milestoneId: string): number {
    const milestone = this.db.milestones.findById(milestoneId);
    if (!milestone) {
      throw new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND");
    }

    // Unassign all issues from this milestone
    const issues = this.db.issues.findMany({ milestoneId });
    for (const issue of issues) {
      this.db.issues.update(issue.id, { milestoneId: undefined });
    }

    this.db.milestones.delete(milestoneId);

    return issues.length;
  }

  /**
   * Assign an issue to a milestone
   */
  assignIssue(issueId: string, milestoneId: string): void {
    const milestone = this.db.milestones.findById(milestoneId);
    if (!milestone) {
      throw new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND");
    }

    this.db.issues.update(issueId, { milestoneId });
  }

  /**
   * Remove an issue from its milestone
   */
  unassignIssue(issueId: string): void {
    this.db.issues.update(issueId, { milestoneId: undefined });
  }

  /**
   * List all milestones with computed status
   *
   * @param statusFilter - Optional filter by computed status
   */
  listMilestones(statusFilter?: MilestoneStatus): MilestoneWithStatus[] {
    const milestones = this.db.milestones.findMany();
    const withStatus = milestones.map((m) => this.withComputedStatus(m));

    if (statusFilter) {
      return withStatus.filter((m) => m.computedStatus === statusFilter);
    }

    return withStatus;
  }
}

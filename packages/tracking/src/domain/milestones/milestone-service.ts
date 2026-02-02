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

import { Effect } from "@dev-workflow/effect";
import { Milestone } from "./milestone.js";
import type {
  MilestoneStatus,
  MilestoneIssueStats,
  CreateMilestoneParams,
  UpdateMilestoneParams,
} from "./milestone.js";
import type { DbClient } from "../../data-access/db-client.js";
import { Service } from "@dev-workflow/effect";

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
export class MilestoneService extends Service<MilestoneService>()("milestoneService") {
  constructor(private readonly db: DbClient) {
    super();
  }

  // ============================================================================
  // Read Operations (delegating to repository)
  // ============================================================================

  /**
   * Find a milestone by ID
   *
   * @returns Milestone or null if not found
   */
  findById(milestoneId: string): Effect<Milestone | null> {
    return this.db.milestones.findById(milestoneId);
  }

  /**
   * Find a milestone by number
   *
   * @returns Milestone or null if not found
   */
  findByNumber(number: number): Effect<Milestone | null> {
    return this.db.milestones.findByNumber(number);
  }

  /**
   * Find many milestones
   */
  findMany(): Effect<Milestone[]> {
    return this.db.milestones.findMany();
  }

  /**
   * Create a milestone (direct repository call, for simpler handlers)
   * For validation, use createMilestone().
   */
  create(data: CreateMilestoneParams): Effect<Milestone> {
    return this.db.milestones.create(data);
  }

  /**
   * Update a milestone (direct repository call, for simpler handlers)
   * For validation, use updateMilestone().
   */
  update(milestoneId: string, updates: UpdateMilestoneParams): Effect<Milestone> {
    return this.db.milestones.update(milestoneId, updates);
  }

  /**
   * Delete a milestone (direct repository call)
   * For unassigning issues, use deleteMilestone().
   */
  delete(milestoneId: string): Effect<void> {
    return this.db.milestones.delete(milestoneId);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Compute issue stats for a milestone
   */
  private computeIssueStats(milestoneId: string): Effect<MilestoneIssueStats> {
    const db = this.db;
    return Effect.gen(function* () {
      const issues = yield* db.issues.findMany({ milestoneId });

      return {
        totalIssues: issues.length,
        closedIssues: issues.filter((i) => i.isClosed).length,
        // Active issues: not closed and not still in planning
        openOrInProgressIssues: issues.filter((i) => !i.isClosed && !i.isInPlanning).length,
      };
    });
  }

  /**
   * Get a milestone with computed status
   */
  private withComputedStatus(milestone: Milestone): Effect<MilestoneWithStatus> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const issueStats = yield* self.computeIssueStats(milestone.id);
      const computedStatus = Milestone.computeStatus(
        milestone.status,
        issueStats,
        milestone.endDate
      );

      return {
        ...milestone,
        computedStatus,
        issueStats,
      };
    });
  }

  /**
   * Get a milestone by ID
   *
   * @returns Effect that fails with MilestoneServiceError if milestone not found
   */
  getMilestone(milestoneId: string): Effect<MilestoneWithStatus, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.db.milestones.findById(milestoneId);
      if (!milestone) {
        return yield* Effect.fail(
          new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND")
        );
      }
      return yield* self.withComputedStatus(milestone);
    });
  }

  /**
   * Get a milestone by number
   *
   * @returns Effect that fails with MilestoneServiceError if milestone not found
   */
  getMilestoneByNumber(number: number): Effect<MilestoneWithStatus, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.db.milestones.findByNumber(number);
      if (!milestone) {
        return yield* Effect.fail(
          new MilestoneServiceError(`Milestone M${number} not found`, "NOT_FOUND")
        );
      }
      return yield* self.withComputedStatus(milestone);
    });
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
  }): Effect<MilestoneWithStatus, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      // Validate date format
      const startCheck = Milestone.validateDate(data.startDate, "startDate");
      if (!startCheck.valid) {
        return yield* Effect.fail(new MilestoneServiceError(startCheck.reason!, "INVALID_DATE"));
      }
      const endCheck = Milestone.validateDate(data.endDate, "endDate");
      if (!endCheck.valid) {
        return yield* Effect.fail(new MilestoneServiceError(endCheck.reason!, "INVALID_DATE"));
      }

      // Validate date range
      const rangeCheck = Milestone.validateDateRange(data.startDate, data.endDate);
      if (!rangeCheck.valid) {
        return yield* Effect.fail(new MilestoneServiceError(rangeCheck.reason!, "INVALID_DATE"));
      }

      const milestone = yield* self.db.milestones.create({
        title: data.title,
        description: data.description ?? "",
        startDate: data.startDate,
        endDate: data.endDate,
        status: "PLANNED",
      });

      return yield* self.withComputedStatus(milestone);
    });
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
  ): Effect<MilestoneWithStatus, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.db.milestones.findById(milestoneId);
      if (!milestone) {
        return yield* Effect.fail(
          new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND")
        );
      }

      // Validate status update
      if (updates.status) {
        const statusCheck = Milestone.canSetStatus(updates.status);
        if (!statusCheck.valid) {
          return yield* Effect.fail(
            new MilestoneServiceError(statusCheck.reason!, "INVALID_STATUS")
          );
        }
      }

      // Validate date format if provided
      if (updates.startDate) {
        const check = Milestone.validateDate(updates.startDate, "startDate");
        if (!check.valid) {
          return yield* Effect.fail(new MilestoneServiceError(check.reason!, "INVALID_DATE"));
        }
      }
      if (updates.endDate) {
        const check = Milestone.validateDate(updates.endDate, "endDate");
        if (!check.valid) {
          return yield* Effect.fail(new MilestoneServiceError(check.reason!, "INVALID_DATE"));
        }
      }

      // Validate date range
      const newStartDate = updates.startDate ?? milestone.startDate;
      const newEndDate = updates.endDate ?? milestone.endDate;
      const rangeCheck = Milestone.validateDateRange(newStartDate, newEndDate);
      if (!rangeCheck.valid) {
        return yield* Effect.fail(new MilestoneServiceError(rangeCheck.reason!, "INVALID_DATE"));
      }

      const updated = yield* self.db.milestones.update(milestoneId, updates);
      return yield* self.withComputedStatus(updated);
    });
  }

  /**
   * Delete a milestone
   *
   * Unassigns all issues from the milestone before deleting.
   *
   * @param milestoneId - Milestone UUID
   * @returns Number of issues that were unassigned
   */
  deleteMilestone(milestoneId: string): Effect<number, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.db.milestones.findById(milestoneId);
      if (!milestone) {
        return yield* Effect.fail(
          new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND")
        );
      }

      // Unassign all issues from this milestone
      const issues = yield* self.db.issues.findMany({ milestoneId });
      for (const issue of issues) {
        yield* self.db.issues.update(issue.id, { milestoneId: undefined });
      }

      yield* self.db.milestones.delete(milestoneId);

      return issues.length;
    });
  }

  /**
   * Assign an issue to a milestone
   */
  assignIssue(issueId: string, milestoneId: string): Effect<void, MilestoneServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.db.milestones.findById(milestoneId);
      if (!milestone) {
        return yield* Effect.fail(
          new MilestoneServiceError(`Milestone not found: ${milestoneId}`, "NOT_FOUND")
        );
      }

      yield* self.db.issues.update(issueId, { milestoneId });
    });
  }

  /**
   * Remove an issue from its milestone
   */
  unassignIssue(issueId: string): Effect<void> {
    return Effect.map(this.db.issues.update(issueId, { milestoneId: undefined }), () => undefined);
  }

  /**
   * List all milestones with computed status
   *
   * @param statusFilter - Optional filter by computed status
   */
  listMilestones(statusFilter?: MilestoneStatus): Effect<MilestoneWithStatus[]> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const allMilestones = yield* self.db.milestones.findMany();
      const withStatus: MilestoneWithStatus[] = [];
      for (const m of allMilestones) {
        withStatus.push(yield* self.withComputedStatus(m));
      }

      if (statusFilter) {
        return withStatus.filter((m) => m.computedStatus === statusFilter);
      }

      return withStatus;
    });
  }
}

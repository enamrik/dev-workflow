/**
 * MilestoneDomainService - Domain logic for milestone operations
 *
 * Encapsulates business rules over MilestoneRepository.
 * Computes milestone status from associated issues.
 */

import { Effect, Service } from "@dev-workflow/effect";
import { Milestone } from "./milestone.js";
import type {
  MilestoneStatus,
  MilestoneRepository,
  MilestoneIssueStats,
  CreateMilestoneParams,
  UpdateMilestoneParams,
} from "./milestone.js";
import type { IssueRepository } from "../issues/issue.js";
import { EntityNotFoundError } from "../errors.js";

export interface MilestoneWithStatus extends Milestone {
  readonly computedStatus: MilestoneStatus;
  readonly issueStats: MilestoneIssueStats;
}

export class MilestoneDomainService extends Service<MilestoneDomainService>()(
  "milestoneDomainService"
) {
  constructor(
    private readonly repo: MilestoneRepository,
    private readonly issueRepo: IssueRepository
  ) {
    super();
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  findById(milestoneId: string): Effect<Milestone | null, never, never> {
    return this.repo.findById(milestoneId);
  }

  getOrThrow(milestoneId: string): Effect<Milestone, EntityNotFoundError, never> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const milestone = yield* repo.findById(milestoneId);
      if (!milestone) {
        return yield* Effect.fail(new EntityNotFoundError("Milestone", milestoneId));
      }
      return milestone;
    });
  }

  findByNumber(number: number): Effect<Milestone | null, never, never> {
    return this.repo.findByNumber(number);
  }

  findMany(): Effect<Milestone[], never, never> {
    return this.repo.findMany();
  }

  /**
   * Compute issue stats for a milestone.
   */
  computeIssueStats(milestoneId: string): Effect<MilestoneIssueStats, never, never> {
    const issueRepo = this.issueRepo;
    return Effect.gen(function* () {
      const issues = yield* issueRepo.findMany({ milestoneId });
      return {
        totalIssues: issues.length,
        closedIssues: issues.filter((i) => i.isClosed).length,
        openOrInProgressIssues: issues.filter((i) => !i.isClosed && !i.isInPlanning).length,
      };
    });
  }

  /**
   * Compute the milestone status from issue stats and dates.
   */
  getComputedStatus(milestone: Milestone): Effect<string, never, never> {
    const self = this;
    return Effect.gen(function* () {
      const stats = yield* self.computeIssueStats(milestone.id);
      return Milestone.computeStatus(milestone.status, stats, milestone.endDate);
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get a milestone with computed status and issue stats.
   */
  private withComputedStatus(milestone: Milestone): Effect<MilestoneWithStatus> {
    const self = this;
    return Effect.gen(function* () {
      const issueStats = yield* self.computeIssueStats(milestone.id);
      const computedStatus = Milestone.computeStatus(
        milestone.status,
        issueStats,
        milestone.endDate
      );
      return { ...milestone, computedStatus, issueStats };
    });
  }

  // ============================================================================
  // Enriched Read Operations
  // ============================================================================

  /**
   * Get a milestone by ID with computed status.
   * Throws EntityNotFoundError if not found.
   */
  getMilestone(milestoneId: string): Effect<MilestoneWithStatus> {
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.repo.findById(milestoneId);
      if (!milestone) {
        throw new EntityNotFoundError("Milestone", milestoneId);
      }
      return yield* self.withComputedStatus(milestone);
    });
  }

  /**
   * Get a milestone by number with computed status.
   * Throws EntityNotFoundError if not found.
   */
  getMilestoneByNumber(number: number): Effect<MilestoneWithStatus> {
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.repo.findByNumber(number);
      if (!milestone) {
        throw new EntityNotFoundError("Milestone", `M${number}`);
      }
      return yield* self.withComputedStatus(milestone);
    });
  }

  /**
   * List all milestones with computed status.
   *
   * @param statusFilter - Optional filter by computed status
   */
  listMilestones(statusFilter?: MilestoneStatus): Effect<MilestoneWithStatus[]> {
    const self = this;
    return Effect.gen(function* () {
      const allMilestones = yield* self.repo.findMany();
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

  // ============================================================================
  // Write Operations
  // ============================================================================

  create(data: CreateMilestoneParams): Effect<Milestone, never, never> {
    return this.repo.create(data);
  }

  update(milestoneId: string, data: UpdateMilestoneParams): Effect<Milestone, never, never> {
    return this.repo.update(milestoneId, data);
  }

  delete(milestoneId: string): Effect<void, never, never> {
    return this.repo.delete(milestoneId);
  }

  // ============================================================================
  // Enriched Write Operations (with validation)
  // ============================================================================

  /**
   * Create a new milestone with date validation.
   * Returns the created milestone with computed status.
   */
  createMilestone(data: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
  }): Effect<MilestoneWithStatus> {
    const self = this;
    return Effect.gen(function* () {
      // Validate date format
      const startCheck = Milestone.validateDate(data.startDate, "startDate");
      if (!startCheck.valid) {
        throw new Error(startCheck.reason!);
      }
      const endCheck = Milestone.validateDate(data.endDate, "endDate");
      if (!endCheck.valid) {
        throw new Error(endCheck.reason!);
      }

      // Validate date range
      const rangeCheck = Milestone.validateDateRange(data.startDate, data.endDate);
      if (!rangeCheck.valid) {
        throw new Error(rangeCheck.reason!);
      }

      const milestone = yield* self.repo.create({
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
   * Update a milestone with validation.
   *
   * Status can only be set to COMPLETED (manual sign-off).
   * Other statuses are computed from issue states.
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
  ): Effect<MilestoneWithStatus> {
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.repo.findById(milestoneId);
      if (!milestone) {
        throw new EntityNotFoundError("Milestone", milestoneId);
      }

      // Validate status update
      if (updates.status) {
        const statusCheck = Milestone.canSetStatus(updates.status);
        if (!statusCheck.valid) {
          throw new Error(statusCheck.reason!);
        }
      }

      // Validate date format if provided
      if (updates.startDate) {
        const check = Milestone.validateDate(updates.startDate, "startDate");
        if (!check.valid) {
          throw new Error(check.reason!);
        }
      }
      if (updates.endDate) {
        const check = Milestone.validateDate(updates.endDate, "endDate");
        if (!check.valid) {
          throw new Error(check.reason!);
        }
      }

      // Validate date range
      const newStartDate = updates.startDate ?? milestone.startDate;
      const newEndDate = updates.endDate ?? milestone.endDate;
      const rangeCheck = Milestone.validateDateRange(newStartDate, newEndDate);
      if (!rangeCheck.valid) {
        throw new Error(rangeCheck.reason!);
      }

      const updated = yield* self.repo.update(milestoneId, updates);
      return yield* self.withComputedStatus(updated);
    });
  }

  /**
   * Delete a milestone and unassign all its issues.
   *
   * @returns Number of issues that were unassigned
   */
  deleteMilestone(milestoneId: string): Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.repo.findById(milestoneId);
      if (!milestone) {
        throw new EntityNotFoundError("Milestone", milestoneId);
      }

      // Unassign all issues from this milestone
      const issues = yield* self.issueRepo.findMany({ milestoneId });
      for (const issue of issues) {
        yield* self.issueRepo.update(issue.id, { milestoneId: undefined });
      }

      yield* self.repo.delete(milestoneId);

      return issues.length;
    });
  }

  /**
   * Assign an issue to a milestone.
   * Throws EntityNotFoundError if milestone not found.
   */
  assignIssue(issueId: string, milestoneId: string): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const milestone = yield* self.repo.findById(milestoneId);
      if (!milestone) {
        throw new EntityNotFoundError("Milestone", milestoneId);
      }

      yield* self.issueRepo.update(issueId, { milestoneId });
    });
  }

  /**
   * Remove an issue from its milestone.
   */
  unassignIssue(issueId: string): Effect<void> {
    return Effect.map(this.issueRepo.update(issueId, { milestoneId: undefined }), () => undefined);
  }
}

/**
 * MilestoneDomainService - Domain logic for milestone operations
 *
 * Encapsulates business rules over MilestoneRepository.
 * Computes milestone status from associated issues.
 */

import { Effect } from "@dev-workflow/effect";
import { Milestone } from "./milestone.js";
import type {
  MilestoneRepository,
  MilestoneIssueStats,
  CreateMilestoneParams,
  UpdateMilestoneParams,
} from "./milestone.js";
import type { IssueRepository } from "../issues/issue.js";
import { EntityNotFoundError } from "../errors.js";

export class MilestoneDomainService {
  constructor(
    private readonly repo: MilestoneRepository,
    private readonly issueRepo: IssueRepository
  ) {}

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
}

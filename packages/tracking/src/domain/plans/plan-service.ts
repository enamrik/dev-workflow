/**
 * PlanService - Application service for plan read operations
 *
 * Provides plan lookup operations. For plan creation/regeneration,
 * use PlanningService which handles the complex orchestration.
 *
 * Follows Service Layer Pattern:
 * - Wraps PlanRepository for read operations
 * - All plan reads should go through this service
 */

import type { Plan } from "./plan.js";
import type { DbClient } from "../../data-access/db-client.js";
import { Service, Effect } from "@dev-workflow/effect";

/**
 * Error thrown when plan operation fails
 */
export class PlanServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "PlanServiceError";
  }
}

/**
 * PlanService - Provides plan lookup operations
 *
 * Note: For plan creation/regeneration, use PlanningService.
 * This service handles reads and simple queries.
 */
export class PlanService extends Service<PlanService>()("planService") {
  constructor(private readonly db: DbClient) {
    super();
  }

  /**
   * Find a plan by ID
   */
  findById(planId: string): Effect<Plan | null> {
    return this.db.plans.findById(planId);
  }

  /**
   * Get a plan by ID, throws if not found
   */
  getPlan(planId: string): Effect<Plan> {
    const self = this;
    return Effect.gen(function* () {
      const plan = yield* self.db.plans.findById(planId);
      if (!plan) {
        throw new PlanServiceError(`Plan not found: ${planId}`, "NOT_FOUND");
      }
      return plan;
    });
  }

  /**
   * Find a plan by issue ID
   */
  findByIssueId(issueId: string): Effect<Plan | null> {
    return this.db.plans.findByIssueId(issueId);
  }

  /**
   * Get a plan by issue ID, throws if not found
   */
  getPlanByIssueId(issueId: string): Effect<Plan> {
    const self = this;
    return Effect.gen(function* () {
      const plan = yield* self.db.plans.findByIssueId(issueId);
      if (!plan) {
        throw new PlanServiceError(`Plan not found for issue: ${issueId}`, "NOT_FOUND");
      }
      return plan;
    });
  }
}

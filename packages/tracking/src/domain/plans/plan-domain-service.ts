/**
 * PlanDomainService - Domain logic for plan operations
 *
 * Encapsulates business rules over PlanRepository.
 * Simple read-oriented service since plan creation/regeneration
 * is handled by PlanningService.
 */

import { Effect } from "@dev-workflow/effect";
import type { Plan, PlanRepository } from "./plan.js";
import { EntityNotFoundError } from "../errors.js";

export class PlanDomainService {
  constructor(private readonly repo: PlanRepository) {}

  findById(planId: string): Effect<Plan | null, never, never> {
    return this.repo.findById(planId);
  }

  getOrThrow(planId: string): Effect<Plan, EntityNotFoundError, never> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const plan = yield* repo.findById(planId);
      if (!plan) {
        return yield* Effect.fail(new EntityNotFoundError("Plan", planId));
      }
      return plan;
    });
  }

  findByIssueId(issueId: string): Effect<Plan | null, never, never> {
    return this.repo.findByIssueId(issueId);
  }

  getByIssueId(issueId: string): Effect<Plan, EntityNotFoundError, never> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const plan = yield* repo.findByIssueId(issueId);
      if (!plan) {
        return yield* Effect.fail(new EntityNotFoundError("Plan", `issue:${issueId}`));
      }
      return plan;
    });
  }
}

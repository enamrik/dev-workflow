import { eq } from "drizzle-orm";
import { plans, type PlanRow } from "@dev-workflow/database/schema.js";
import type { Plan, PlanRepository } from "./plan.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import { Effect } from "@dev-workflow/effect";

/**
 * Drizzle implementation of PlanRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 */
export class DrizzlePlanRepository implements PlanRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(data: Omit<Plan, "id" | "createdAt" | "updatedAt">): Effect<Plan> {
    return Effect.promise(async () => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const plan: Plan = {
        id,
        ...data,
        createdAt: now,
        updatedAt: now,
      };

      // Insert into database
      this.db
        .insert(plans)
        .values({
          id: plan.id,
          issueId: plan.issueId,
          summary: plan.summary,
          approach: plan.approach,
          estimatedComplexity: plan.estimatedComplexity,
          generatedBy: plan.generatedBy,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
        })
        .run();

      return plan;
    });
  }

  findById(id: string): Effect<Plan | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(plans).where(eq(plans.id, id)).get();

      return result ? this.mapRowToPlan(result) : null;
    });
  }

  findByIssueId(issueId: string): Effect<Plan | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(plans).where(eq(plans.issueId, issueId)).get();

      return result ? this.mapRowToPlan(result) : null;
    });
  }

  update(id: string, data: Partial<Omit<Plan, "id" | "issueId" | "createdAt">>): Effect<Plan> {
    const db = this.db;
    const findById = (planId: string) => this.findById(planId);
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      db.update(plans)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(plans.id, id))
        .run();

      const updatedPlan = yield* findById(id);
      if (!updatedPlan) {
        throw new Error(`Failed to update plan: ${id}`);
      }

      return updatedPlan;
    });
  }

  delete(id: string): Effect<void> {
    return Effect.promise(async () => {
      this.db.delete(plans).where(eq(plans.id, id)).run();
    });
  }

  /**
   * Map database row to domain Plan object
   *
   * Handles type conversion.
   */
  private mapRowToPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      issueId: row.issueId,
      summary: row.summary,
      approach: row.approach,
      estimatedComplexity: row.estimatedComplexity as Plan["estimatedComplexity"],
      generatedBy: row.generatedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

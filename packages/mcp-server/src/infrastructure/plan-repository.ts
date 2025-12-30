import { eq } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { plans, PlanRow } from "./schema.js";
import type { Plan, PlanRepository } from "../domain/plan.js";
import * as schema from "./schema.js";

/**
 * SQLite implementation of PlanRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 */
export class SqlitePlanRepository implements PlanRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  create(data: Omit<Plan, "id" | "createdAt" | "updatedAt">): Plan {
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
  }

  findById(id: string): Plan | null {
    const result = this.db
      .select()
      .from(plans)
      .where(eq(plans.id, id))
      .get();

    return result ? this.mapRowToPlan(result) : null;
  }

  findByIssueId(issueId: string): Plan | null {
    const result = this.db
      .select()
      .from(plans)
      .where(eq(plans.issueId, issueId))
      .get();

    return result ? this.mapRowToPlan(result) : null;
  }

  update(
    id: string,
    data: Partial<Omit<Plan, "id" | "issueId" | "createdAt">>
  ): Plan {
    const now = new Date().toISOString();

    this.db
      .update(plans)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(plans.id, id))
      .run();

    const updatedPlan = this.findById(id);
    if (!updatedPlan) {
      throw new Error(`Failed to update plan: ${id}`);
    }

    return updatedPlan;
  }

  delete(id: string): void {
    this.db.delete(plans).where(eq(plans.id, id)).run();
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

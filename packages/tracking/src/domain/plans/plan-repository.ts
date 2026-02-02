import { eq } from "drizzle-orm";
import { plans, type PlanRow } from "@dev-workflow/database/schema.js";
import type { Plan, PlanRepository } from "./plan.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/**
 * Drizzle implementation of PlanRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 */
export class DrizzlePlanRepository implements PlanRepository {
  constructor(private readonly db: DrizzleDb) {}

  async create(data: Omit<Plan, "id" | "createdAt" | "updatedAt">): Promise<Plan> {
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

  async findById(id: string): Promise<Plan | null> {
    const result = this.db.select().from(plans).where(eq(plans.id, id)).get();

    return result ? this.mapRowToPlan(result) : null;
  }

  async findByIssueId(issueId: string): Promise<Plan | null> {
    const result = this.db.select().from(plans).where(eq(plans.issueId, issueId)).get();

    return result ? this.mapRowToPlan(result) : null;
  }

  async update(
    id: string,
    data: Partial<Omit<Plan, "id" | "issueId" | "createdAt">>
  ): Promise<Plan> {
    const now = new Date().toISOString();

    this.db
      .update(plans)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(plans.id, id))
      .run();

    const updatedPlan = await this.findById(id);
    if (!updatedPlan) {
      throw new Error(`Failed to update plan: ${id}`);
    }

    return updatedPlan;
  }

  async delete(id: string): Promise<void> {
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

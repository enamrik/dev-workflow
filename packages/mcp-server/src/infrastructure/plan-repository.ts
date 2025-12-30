import { eq, and } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { plans, snapshots, PlanRow } from "./schema.js";
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
        snapshotId: plan.snapshotId,
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

  findActiveByIssueId(issueId: string): Plan | null {
    // Get plan where snapshot is active for this issue
    const result = this.db
      .select({
        plan: plans,
      })
      .from(plans)
      .innerJoin(snapshots, eq(plans.snapshotId, snapshots.id))
      .where(
        and(eq(plans.issueId, issueId), eq(snapshots.status, "ACTIVE"))
      )
      .get();

    return result ? this.mapRowToPlan(result.plan) : null;
  }

  findBySnapshotId(snapshotId: string): Plan | null {
    const result = this.db
      .select()
      .from(plans)
      .where(eq(plans.snapshotId, snapshotId))
      .get();

    return result ? this.mapRowToPlan(result) : null;
  }

  /**
   * Map database row to domain Plan object
   *
   * Handles type conversion.
   */
  private mapRowToPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      snapshotId: row.snapshotId,
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

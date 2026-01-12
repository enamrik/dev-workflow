import { eq, max, and, asc } from "drizzle-orm";
import { milestones, MilestoneRow } from "../database/schema.js";
import type { Milestone, MilestoneRepository, MilestoneFilters } from "../../domain/milestone.js";
import type { DrizzleDb } from "../../domain/drizzle-db.js";

/**
 * Drizzle implementation of MilestoneRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 *
 * The repository is scoped to a specific project via projectId.
 * All queries automatically filter by this project.
 */
export class DrizzleMilestoneRepository implements MilestoneRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly projectId: string
  ) {}

  create(
    data: Omit<Milestone, "id" | "projectId" | "number" | "createdAt" | "updatedAt">
  ): Milestone {
    const id = crypto.randomUUID();
    const number = this.getNextMilestoneNumber();
    const now = new Date().toISOString();

    const milestone: Milestone = {
      id,
      projectId: this.projectId,
      number,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into database
    this.db
      .insert(milestones)
      .values({
        id: milestone.id,
        projectId: milestone.projectId,
        number: milestone.number,
        title: milestone.title,
        description: milestone.description,
        startDate: milestone.startDate,
        endDate: milestone.endDate,
        status: milestone.status,
        createdAt: milestone.createdAt,
        updatedAt: milestone.updatedAt,
      })
      .run();

    return milestone;
  }

  findById(id: string): Milestone | null {
    const result = this.db
      .select()
      .from(milestones)
      .where(and(eq(milestones.projectId, this.projectId), eq(milestones.id, id)))
      .get();

    return result ? this.mapRowToMilestone(result) : null;
  }

  findByNumber(number: number): Milestone | null {
    const result = this.db
      .select()
      .from(milestones)
      .where(and(eq(milestones.projectId, this.projectId), eq(milestones.number, number)))
      .get();

    return result ? this.mapRowToMilestone(result) : null;
  }

  findMany(filters?: MilestoneFilters): Milestone[] {
    // Always filter by project
    const conditions = [eq(milestones.projectId, this.projectId)];

    // Apply status filter if provided
    if (filters?.status) {
      conditions.push(eq(milestones.status, filters.status));
    }

    const results = this.db
      .select()
      .from(milestones)
      .where(and(...conditions))
      .orderBy(asc(milestones.startDate))
      .all();

    return results.map((row) => this.mapRowToMilestone(row));
  }

  getNextMilestoneNumber(): number {
    const result = this.db
      .select({ maxNumber: max(milestones.number) })
      .from(milestones)
      .where(eq(milestones.projectId, this.projectId))
      .get();

    return (result?.maxNumber ?? 0) + 1;
  }

  update(
    id: string,
    data: Partial<Omit<Milestone, "id" | "projectId" | "number" | "createdAt">>
  ): Milestone {
    const now = new Date().toISOString();

    this.db
      .update(milestones)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(and(eq(milestones.projectId, this.projectId), eq(milestones.id, id)))
      .run();

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to update milestone: ${id}`);
    }

    return updated;
  }

  delete(id: string): void {
    this.db
      .delete(milestones)
      .where(and(eq(milestones.projectId, this.projectId), eq(milestones.id, id)))
      .run();
  }

  /**
   * Map database row to domain Milestone object
   */
  private mapRowToMilestone(row: MilestoneRow): Milestone {
    return {
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      title: row.title,
      description: row.description,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status as Milestone["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

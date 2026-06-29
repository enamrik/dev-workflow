import { eq, max, and, asc } from "drizzle-orm";
import { milestones, type MilestoneRow } from "@dev-workflow/database/schema.js";
import {
  Milestone,
  type MilestoneRepository,
  type MilestoneFilters,
  type CreateMilestoneParams,
  type UpdateMilestoneParams,
} from "./milestone.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import { Effect } from "@dev-workflow/effect";

/**
 * Drizzle implementation of MilestoneRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 *
 * Milestones are global (not project-scoped) - a single milestone can group
 * issues from any project, so this repository queries the whole milestones
 * table without a project filter.
 */
export class DrizzleMilestoneRepository implements MilestoneRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(data: CreateMilestoneParams): Effect<Milestone> {
    const self = this;
    return Effect.gen(function* () {
      const id = crypto.randomUUID();
      const number = yield* self.getNextMilestoneNumber();
      const now = new Date().toISOString();

      const milestone = Milestone.from({
        id,
        number,
        ...data,
        createdAt: now,
        updatedAt: now,
      });

      // Insert into database
      self.db
        .insert(milestones)
        .values({
          id: milestone.id,
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
    });
  }

  findById(id: string): Effect<Milestone | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(milestones).where(eq(milestones.id, id)).get();

      return result ? this.mapRowToMilestone(result) : null;
    });
  }

  findByNumber(number: number): Effect<Milestone | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(milestones).where(eq(milestones.number, number)).get();

      return result ? this.mapRowToMilestone(result) : null;
    });
  }

  findMany(filters?: MilestoneFilters): Effect<Milestone[]> {
    return Effect.promise(async () => {
      const conditions = [];

      // Apply status filter if provided
      if (filters?.status) {
        conditions.push(eq(milestones.status, filters.status));
      }

      const query = this.db.select().from(milestones);
      const results = (conditions.length > 0 ? query.where(and(...conditions)) : query)
        .orderBy(asc(milestones.startDate))
        .all();

      return results.map((row) => this.mapRowToMilestone(row));
    });
  }

  getNextMilestoneNumber(): Effect<number> {
    return Effect.promise(async () => {
      const result = this.db
        .select({ maxNumber: max(milestones.number) })
        .from(milestones)
        .get();

      return (result?.maxNumber ?? 0) + 1;
    });
  }

  update(id: string, data: UpdateMilestoneParams): Effect<Milestone> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(milestones)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(milestones.id, id))
        .run();

      const updated = yield* self.findById(id);
      if (!updated) {
        throw new Error(`Failed to update milestone: ${id}`);
      }

      return updated;
    });
  }

  delete(id: string): Effect<void> {
    return Effect.promise(async () => {
      this.db.delete(milestones).where(eq(milestones.id, id)).run();
    });
  }

  /**
   * Map database row to domain Milestone object
   */
  private mapRowToMilestone(row: MilestoneRow): Milestone {
    return Milestone.from({
      id: row.id,
      number: row.number,
      title: row.title,
      description: row.description,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status as Milestone["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}

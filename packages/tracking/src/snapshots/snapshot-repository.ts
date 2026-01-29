import { eq, max, and, desc } from "drizzle-orm";
import { snapshots, type SnapshotRow } from "@dev-workflow/database/schema.js";
import type { Snapshot, SnapshotRepository } from "./snapshot.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/**
 * Drizzle implementation of SnapshotRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 *
 * The repository is scoped to a specific project via projectId.
 * All queries automatically filter by this project.
 */
export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly projectId: string
  ) {}

  create(data: Omit<Snapshot, "id" | "projectId" | "version" | "createdAt">): Snapshot {
    const id = crypto.randomUUID();
    const version = this.getNextVersion(data.issueNumber);
    const now = new Date().toISOString();

    const snapshot: Snapshot = {
      id,
      projectId: this.projectId,
      version,
      ...data,
      createdAt: now,
    };

    // Insert into database
    this.db
      .insert(snapshots)
      .values({
        id: snapshot.id,
        projectId: snapshot.projectId,
        issueNumber: snapshot.issueNumber,
        version: snapshot.version,
        status: snapshot.status,
        snapshotType: snapshot.snapshotType,
        issueState: snapshot.issueState,
        planState: snapshot.planState,
        tasksState: snapshot.tasksState,
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt,
        notes: snapshot.notes,
      })
      .run();

    return snapshot;
  }

  findById(id: string): Snapshot | null {
    const result = this.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.projectId, this.projectId), eq(snapshots.id, id)))
      .get();

    return result ? this.mapRowToSnapshot(result) : null;
  }

  findActiveByIssueNumber(issueNumber: number): Snapshot | null {
    const result = this.db
      .select()
      .from(snapshots)
      .where(
        and(
          eq(snapshots.projectId, this.projectId),
          eq(snapshots.issueNumber, issueNumber),
          eq(snapshots.status, "ACTIVE")
        )
      )
      .get();

    return result ? this.mapRowToSnapshot(result) : null;
  }

  findByIssueNumber(issueNumber: number): Snapshot[] {
    const results = this.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.projectId, this.projectId), eq(snapshots.issueNumber, issueNumber)))
      .orderBy(desc(snapshots.version))
      .all();

    return results.map((row) => this.mapRowToSnapshot(row));
  }

  getNextVersion(issueNumber: number): number {
    const result = this.db
      .select({ maxVersion: max(snapshots.version) })
      .from(snapshots)
      .where(and(eq(snapshots.projectId, this.projectId), eq(snapshots.issueNumber, issueNumber)))
      .get();

    return (result?.maxVersion ?? 0) + 1;
  }

  archiveCurrent(issueNumber: number): void {
    this.db
      .update(snapshots)
      .set({ status: "ARCHIVED" })
      .where(
        and(
          eq(snapshots.projectId, this.projectId),
          eq(snapshots.issueNumber, issueNumber),
          eq(snapshots.status, "ACTIVE")
        )
      )
      .run();
  }

  findByVersion(issueNumber: number, version: number): Snapshot | null {
    const result = this.db
      .select()
      .from(snapshots)
      .where(
        and(
          eq(snapshots.projectId, this.projectId),
          eq(snapshots.issueNumber, issueNumber),
          eq(snapshots.version, version)
        )
      )
      .get();

    return result ? this.mapRowToSnapshot(result) : null;
  }

  /**
   * Map database row to domain Snapshot object
   *
   * Handles type conversion and null-to-undefined mapping for optional fields.
   */
  private mapRowToSnapshot(row: SnapshotRow): Snapshot {
    return {
      id: row.id,
      projectId: row.projectId,
      issueNumber: row.issueNumber,
      version: row.version,
      status: row.status as Snapshot["status"],
      snapshotType: row.snapshotType as Snapshot["snapshotType"],
      issueState: row.issueState as Snapshot["issueState"],
      planState: (row.planState ?? null) as Snapshot["planState"],
      tasksState: row.tasksState as Snapshot["tasksState"],
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      notes: row.notes ?? undefined,
    };
  }
}

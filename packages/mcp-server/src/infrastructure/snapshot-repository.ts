import { eq, max, and, desc } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { snapshots, SnapshotRow } from "./schema.js";
import type {
  Snapshot,
  SnapshotRepository,
} from "../domain/snapshot.js";
import * as schema from "./schema.js";

/**
 * SQLite implementation of SnapshotRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 */
export class SqliteSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  create(data: Omit<Snapshot, "id" | "version" | "createdAt">): Snapshot {
    const id = crypto.randomUUID();
    const version = this.getNextVersion(data.issueNumber);
    const now = new Date().toISOString();

    const snapshot: Snapshot = {
      id,
      version,
      ...data,
      createdAt: now,
    };

    // Insert into database
    this.db
      .insert(snapshots)
      .values({
        id: snapshot.id,
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
      .where(eq(snapshots.id, id))
      .get();

    return result ? this.mapRowToSnapshot(result) : null;
  }

  findActiveByIssueNumber(issueNumber: number): Snapshot | null {
    const result = this.db
      .select()
      .from(snapshots)
      .where(
        and(
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
      .where(eq(snapshots.issueNumber, issueNumber))
      .orderBy(desc(snapshots.version))
      .all();

    return results.map((row) => this.mapRowToSnapshot(row));
  }

  getNextVersion(issueNumber: number): number {
    const result = this.db
      .select({ maxVersion: max(snapshots.version) })
      .from(snapshots)
      .where(eq(snapshots.issueNumber, issueNumber))
      .get();

    return (result?.maxVersion ?? 0) + 1;
  }

  archiveCurrent(issueNumber: number): void {
    this.db
      .update(snapshots)
      .set({ status: "ARCHIVED" })
      .where(
        and(
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
      issueNumber: row.issueNumber,
      version: row.version,
      status: row.status as Snapshot["status"],
      snapshotType: row.snapshotType as Snapshot["snapshotType"],
      issueState: row.issueState,
      planState: row.planState ?? null,
      tasksState: row.tasksState,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      notes: row.notes ?? undefined,
    };
  }
}

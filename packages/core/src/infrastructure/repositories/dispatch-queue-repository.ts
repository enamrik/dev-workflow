import { eq, isNull, or, lte, sql } from "drizzle-orm";
import { dispatchQueue, workers, DispatchQueueRow } from "../database/schema.js";
import type {
  DispatchQueueEntry,
  DispatchQueueEntryWithHealth,
  DispatchQueueRepository,
} from "../../domain/worker.js";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS, isWorkerAlive } from "../../domain/worker.js";
import type { SqliteDrizzleDatabase } from "../../domain/data-source.js";

/**
 * SQLite implementation of DispatchQueueRepository
 *
 * Manages the queue of tasks waiting to be claimed by workers.
 * The key feature is atomic claiming to prevent race conditions.
 */
export class SqliteDispatchQueueRepository implements DispatchQueueRepository {
  constructor(private readonly db: SqliteDrizzleDatabase) {}

  enqueue(taskId: string): DispatchQueueEntry {
    const now = new Date().toISOString();

    // Check if already queued
    const existing = this.findByTaskId(taskId);
    if (existing) {
      return existing;
    }

    const entry: DispatchQueueEntry = {
      taskId,
      workerId: null,
      claimedAt: null,
      createdAt: now,
    };

    this.db
      .insert(dispatchQueue)
      .values({
        taskId: entry.taskId,
        workerId: entry.workerId,
        claimedAt: entry.claimedAt,
        createdAt: entry.createdAt,
      })
      .run();

    return entry;
  }

  claimTask(
    workerId: string,
    thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  ): DispatchQueueEntry | null {
    const now = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    // Find a claimable task:
    // 1. Unclaimed (worker_id IS NULL), OR
    // 2. Claimed by a worker with stale heartbeat
    //
    // We use a raw SQL approach for atomicity - the claim happens in one statement
    // so if two workers race, only one will succeed.

    // First, find a candidate task
    const candidate = this.db
      .select({
        taskId: dispatchQueue.taskId,
        workerId: dispatchQueue.workerId,
      })
      .from(dispatchQueue)
      .leftJoin(workers, eq(dispatchQueue.workerId, workers.id))
      .where(
        or(
          // Unclaimed
          isNull(dispatchQueue.workerId),
          // Claimed but worker is dead (no worker record or stale heartbeat)
          isNull(workers.id),
          lte(workers.lastHeartbeat, staleThreshold)
        )
      )
      .limit(1)
      .get();

    if (!candidate) {
      return null;
    }

    // Atomic claim: UPDATE only if the condition still holds
    // This prevents race conditions - if another worker claimed it between
    // our SELECT and UPDATE, our UPDATE will affect 0 rows.
    const result = this.db
      .update(dispatchQueue)
      .set({
        workerId,
        claimedAt: now,
      })
      .where(
        sql`${dispatchQueue.taskId} = ${candidate.taskId}
            AND (
              ${dispatchQueue.workerId} IS NULL
              OR ${dispatchQueue.workerId} = ${candidate.workerId}
            )`
      )
      .run();

    if (result.changes === 0) {
      // Lost the race, another worker claimed it
      return null;
    }

    // Return the claimed entry
    return this.findByTaskId(candidate.taskId);
  }

  releaseClaim(taskId: string): void {
    this.db.delete(dispatchQueue).where(eq(dispatchQueue.taskId, taskId)).run();
  }

  findClaimByWorker(workerId: string): DispatchQueueEntry | null {
    const result = this.db
      .select()
      .from(dispatchQueue)
      .where(eq(dispatchQueue.workerId, workerId))
      .get();

    return result ? this.mapRowToEntry(result) : null;
  }

  findByTaskId(taskId: string): DispatchQueueEntry | null {
    const result = this.db
      .select()
      .from(dispatchQueue)
      .where(eq(dispatchQueue.taskId, taskId))
      .get();

    return result ? this.mapRowToEntry(result) : null;
  }

  findAllWithHealth(
    thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  ): DispatchQueueEntryWithHealth[] {
    // Join with workers to get names and heartbeats
    const results = this.db
      .select({
        taskId: dispatchQueue.taskId,
        workerId: dispatchQueue.workerId,
        claimedAt: dispatchQueue.claimedAt,
        createdAt: dispatchQueue.createdAt,
        workerName: workers.name,
        workerLastHeartbeat: workers.lastHeartbeat,
      })
      .from(dispatchQueue)
      .leftJoin(workers, eq(dispatchQueue.workerId, workers.id))
      .all();

    const now = new Date();

    return results.map((row) => {
      const entry = this.mapRowToEntry({
        taskId: row.taskId,
        workerId: row.workerId,
        claimedAt: row.claimedAt,
        createdAt: row.createdAt,
      });

      // Determine staleness
      let isStale = false;
      if (row.workerId) {
        if (!row.workerLastHeartbeat) {
          // Worker record doesn't exist - claim is stale
          isStale = true;
        } else {
          // Check heartbeat age
          isStale = !isWorkerAlive(row.workerLastHeartbeat, thresholdSeconds, now);
        }
      }

      return {
        ...entry,
        isStale,
        workerName: row.workerName ?? null,
      };
    });
  }

  getQueueStats(thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS): {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  } {
    const entries = this.findAllWithHealth(thresholdSeconds);

    const total = entries.length;
    const unclaimed = entries.filter((e) => e.workerId === null).length;
    const claimed = entries.filter((e) => e.workerId !== null).length;
    const stale = entries.filter((e) => e.isStale).length;

    return { total, unclaimed, claimed, stale };
  }

  /**
   * Map database row to domain DispatchQueueEntry object
   */
  private mapRowToEntry(row: DispatchQueueRow): DispatchQueueEntry {
    return {
      taskId: row.taskId,
      workerId: row.workerId,
      claimedAt: row.claimedAt,
      createdAt: row.createdAt,
    };
  }
}

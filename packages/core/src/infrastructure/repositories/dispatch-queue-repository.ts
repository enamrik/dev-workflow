import { eq, or, sql } from "drizzle-orm";
import { dispatchQueue, workers, DispatchQueueRow } from "../database/schema.js";
import type {
  DispatchQueueEntry,
  DispatchQueueEntryWithHealth,
  DispatchQueueRepository,
  DispatchQueueStatus,
} from "../../domain/worker.js";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS, isWorkerAlive } from "../../domain/worker.js";
import type { DrizzleDb } from "../../domain/drizzle-db.js";

/**
 * Drizzle implementation of DispatchQueueRepository
 *
 * Manages the queue of tasks assigned to workers.
 * Entry persists until task reaches terminal state (COMPLETED/ABANDONED).
 * Works with any Drizzle-supported database dialect.
 */
export class DrizzleDispatchQueueRepository implements DispatchQueueRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Kill a stale worker process before reclaiming its task.
   * This prevents two workers from working on the same task simultaneously.
   *
   * @param workerId - The stale worker's ID
   * @returns true if kill was attempted (regardless of success)
   */
  private killStaleWorkerProcess(workerId: string): boolean {
    // Get the worker's PID from the database
    const worker = this.db
      .select({ pid: workers.pid })
      .from(workers)
      .where(eq(workers.id, workerId))
      .get();

    if (!worker?.pid) {
      // No PID recorded, nothing to kill
      return false;
    }

    try {
      // Send SIGTERM to gracefully terminate the process
      process.kill(worker.pid, "SIGTERM");
      return true;
    } catch (error) {
      // Process may have already exited (ESRCH) or we don't have permission (EPERM)
      // In either case, we proceed with reclamation
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH") {
        // Log unexpected errors, but don't block reclamation
        console.warn(`Failed to kill stale worker process (PID ${worker.pid}): ${errorCode}`);
      }
      return false;
    }
  }

  enqueue(taskId: string): DispatchQueueEntry {
    const now = new Date().toISOString();

    // Check if already queued
    const existing = this.findByTaskId(taskId);
    if (existing) {
      return existing;
    }

    const entry: DispatchQueueEntry = {
      taskId,
      status: "PENDING",
      workerId: null,
      claimedAt: null,
      createdAt: now,
      claudeDone: false,
      claudeDoneAt: null,
    };

    this.db
      .insert(dispatchQueue)
      .values({
        taskId: entry.taskId,
        status: entry.status,
        workerId: entry.workerId,
        claimedAt: entry.claimedAt,
        createdAt: entry.createdAt,
        claudeDone: entry.claudeDone,
        claudeDoneAt: entry.claudeDoneAt,
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
    // 1. PENDING status, OR
    // 2. WORKING status but worker has stale heartbeat
    //
    // We use a raw SQL approach for atomicity - the claim happens in one statement
    // so if two workers race, only one will succeed.

    // First, find a candidate task
    const candidate = this.db
      .select({
        taskId: dispatchQueue.taskId,
        status: dispatchQueue.status,
        workerId: dispatchQueue.workerId,
      })
      .from(dispatchQueue)
      .leftJoin(workers, eq(dispatchQueue.workerId, workers.id))
      .where(
        or(
          // PENDING - never claimed
          eq(dispatchQueue.status, "PENDING"),
          // WORKING but worker is dead (no worker record or stale heartbeat)
          sql`${dispatchQueue.status} = 'WORKING' AND (${workers.id} IS NULL OR ${workers.lastHeartbeat} <= ${staleThreshold})`
        )
      )
      .limit(1)
      .get();

    if (!candidate) {
      return null;
    }

    // If reclaiming from a stale worker, kill the old worker process first
    // This prevents two workers from working on the same task simultaneously
    if (candidate.status === "WORKING" && candidate.workerId) {
      this.killStaleWorkerProcess(candidate.workerId);
    }

    // Atomic claim: UPDATE only if the condition still holds
    // This prevents race conditions - if another worker claimed it between
    // our SELECT and UPDATE, our UPDATE will affect 0 rows.
    const result = this.db
      .update(dispatchQueue)
      .set({
        status: "WORKING",
        workerId,
        claimedAt: now,
      })
      .where(
        sql`${dispatchQueue.taskId} = ${candidate.taskId}
            AND (
              ${dispatchQueue.status} = 'PENDING'
              OR (${dispatchQueue.status} = 'WORKING' AND ${dispatchQueue.workerId} = ${candidate.workerId})
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

  /**
   * Remove a task from the queue.
   * Called when task reaches terminal state (COMPLETED/ABANDONED).
   *
   * @param taskId - Task to remove
   */
  remove(taskId: string): void {
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
        status: dispatchQueue.status,
        workerId: dispatchQueue.workerId,
        claimedAt: dispatchQueue.claimedAt,
        createdAt: dispatchQueue.createdAt,
        claudeDone: dispatchQueue.claudeDone,
        claudeDoneAt: dispatchQueue.claudeDoneAt,
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
        status: row.status,
        workerId: row.workerId,
        claimedAt: row.claimedAt,
        createdAt: row.createdAt,
        claudeDone: row.claudeDone,
        claudeDoneAt: row.claudeDoneAt,
      });

      // Determine staleness - only relevant for WORKING status
      let isStale = false;
      if (entry.status === "WORKING" && row.workerId) {
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
    const unclaimed = entries.filter((e) => e.status === "PENDING").length;
    const claimed = entries.filter((e) => e.status === "WORKING").length;
    const stale = entries.filter((e) => e.isStale).length;

    return { total, unclaimed, claimed, stale };
  }

  setClaudeDone(taskId: string, workerId: string): DispatchQueueEntry | null {
    const now = new Date().toISOString();

    // Find the existing entry
    const existing = this.findByTaskId(taskId);
    if (!existing) {
      return null;
    }

    // Verify the workerId matches
    if (existing.workerId !== workerId) {
      return null;
    }

    // Update the entry
    this.db
      .update(dispatchQueue)
      .set({
        claudeDone: true,
        claudeDoneAt: now,
      })
      .where(eq(dispatchQueue.taskId, taskId))
      .run();

    return this.findByTaskId(taskId);
  }

  /**
   * Map database row to domain DispatchQueueEntry object
   */
  private mapRowToEntry(row: DispatchQueueRow): DispatchQueueEntry {
    return {
      taskId: row.taskId,
      status: (row.status ?? "PENDING") as DispatchQueueStatus,
      workerId: row.workerId,
      claimedAt: row.claimedAt,
      createdAt: row.createdAt,
      claudeDone: row.claudeDone ?? false,
      claudeDoneAt: row.claudeDoneAt ?? null,
    };
  }
}

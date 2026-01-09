import { eq, lte, like } from "drizzle-orm";
import { workers, dispatchQueue, WorkerRow } from "../database/schema.js";
import type {
  Worker,
  WorkerStatus,
  WorkerWithHealth,
  WorkerRepository,
} from "../../domain/worker.js";
import {
  DEFAULT_HEARTBEAT_THRESHOLD_SECONDS,
  isWorkerAlive,
  getHeartbeatAge,
} from "../../domain/worker.js";
import type { SqliteDrizzleDatabase } from "../../domain/data-source.js";

/** Threshold for cleaning up dead workers on registration (1 hour) */
const DEAD_WORKER_CLEANUP_THRESHOLD_SECONDS = 3600;

/**
 * SQLite implementation of WorkerRepository
 *
 * Manages worker registration, heartbeats, and lifecycle.
 * Workers are global (not project-scoped).
 */
export class SqliteWorkerRepository implements WorkerRepository {
  constructor(private readonly db: SqliteDrizzleDatabase) {}

  register(id: string, name: string): Worker {
    // Clean up workers that have been dead for over an hour
    this.cleanupDeadWorkers(DEAD_WORKER_CLEANUP_THRESHOLD_SECONDS);

    const now = new Date().toISOString();

    const worker: Worker = {
      id,
      name,
      status: "IDLE",
      lastHeartbeat: now,
      createdAt: now,
    };

    this.db
      .insert(workers)
      .values({
        id: worker.id,
        name: worker.name,
        status: worker.status,
        lastHeartbeat: worker.lastHeartbeat,
        createdAt: worker.createdAt,
      })
      .run();

    return worker;
  }

  unregister(id: string): void {
    this.db.delete(workers).where(eq(workers.id, id)).run();
  }

  updateHeartbeat(id: string): Worker | null {
    const now = new Date().toISOString();

    const result = this.db
      .update(workers)
      .set({ lastHeartbeat: now })
      .where(eq(workers.id, id))
      .run();

    if (result.changes === 0) {
      return null;
    }

    return this.findById(id);
  }

  updateStatus(id: string, status: WorkerStatus): Worker | null {
    const result = this.db.update(workers).set({ status }).where(eq(workers.id, id)).run();

    if (result.changes === 0) {
      return null;
    }

    return this.findById(id);
  }

  findById(id: string): Worker | null {
    const result = this.db.select().from(workers).where(eq(workers.id, id)).get();

    return result ? this.mapRowToWorker(result) : null;
  }

  findAllWithHealth(
    thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  ): WorkerWithHealth[] {
    const allWorkers = this.db.select().from(workers).all();

    // Get current task claims for each worker
    const claims = this.db.select().from(dispatchQueue).all();
    const claimsByWorker = new Map(
      claims.filter((c) => c.workerId).map((c) => [c.workerId, c.taskId])
    );

    const now = new Date();

    return allWorkers.map((row) => {
      const worker = this.mapRowToWorker(row);
      return {
        ...worker,
        isAlive: isWorkerAlive(worker.lastHeartbeat, thresholdSeconds, now),
        heartbeatAge: getHeartbeatAge(worker.lastHeartbeat, now),
        currentTaskId: claimsByWorker.get(worker.id) ?? null,
      };
    });
  }

  cleanupDeadWorkers(thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS): number {
    const cutoff = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    const result = this.db.delete(workers).where(lte(workers.lastHeartbeat, cutoff)).run();

    return result.changes;
  }

  getNextWorkerName(): string {
    // Find the highest worker-N number currently in use
    const result = this.db
      .select({ name: workers.name })
      .from(workers)
      .where(like(workers.name, "worker-%"))
      .all();

    const numbers = result
      .map((r) => {
        const match = r.name.match(/^worker-(\d+)$/);
        return match ? parseInt(match[1]!, 10) : 0;
      })
      .filter((n) => n > 0);

    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `worker-${maxNumber + 1}`;
  }

  /**
   * Map database row to domain Worker object
   */
  private mapRowToWorker(row: WorkerRow): Worker {
    return {
      id: row.id,
      name: row.name,
      status: row.status as WorkerStatus,
      lastHeartbeat: row.lastHeartbeat,
      createdAt: row.createdAt,
    };
  }
}

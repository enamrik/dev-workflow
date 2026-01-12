/**
 * GlobalDbWorkerQueueDb - SQLite implementation of WorkerQueueDb
 *
 * Manages worker registration and dispatch queue in ~/.track/worker-queue.db
 * Separate from the main tracking database (workflow.db).
 */

import * as path from "node:path";
import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, or, sql } from "drizzle-orm";

import { resolveGlobalTrackDir } from "../../application/track-directory-resolver.js";
import type {
  WorkerQueueDb,
  QueueEntry,
  QueueEntryWithHealth,
  QueueStats,
  WorkerSummary,
  QueueEntryStatus,
} from "../../domain/worker-queue-db.js";
import type { Worker, WorkerWithHealth, WorkerStatus } from "../../domain/worker.js";
import {
  DEFAULT_HEARTBEAT_THRESHOLD_SECONDS,
  isWorkerAlive,
  getHeartbeatAge,
} from "../../domain/worker.js";
import { workers, dispatchQueue, WorkerRow, DispatchQueueRow } from "./schema.js";

/**
 * Get the path to the worker queue database
 */
export function getWorkerQueueDbPath(): string {
  return path.join(resolveGlobalTrackDir(), "worker-queue.db");
}

/**
 * GlobalDbWorkerQueueDb - Implementation of WorkerQueueDb
 *
 * Uses SQLite at ~/.track/worker-queue.db
 */
export class GlobalDbWorkerQueueDb implements WorkerQueueDb {
  private readonly sqlite: Database.Database;
  private readonly db: BetterSQLite3Database;

  constructor(dbPath?: string) {
    const actualPath = dbPath ?? getWorkerQueueDbPath();
    this.sqlite = new Database(actualPath);
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite);

    // Run migrations (create tables if needed)
    this.runMigrations();
  }

  /**
   * Create tables if they don't exist
   *
   * For now, we use direct SQL. Could switch to drizzle-kit migrations later.
   */
  private runMigrations(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'IDLE',
        last_heartbeat TEXT NOT NULL,
        pid INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatch_queue (
        task_id TEXT PRIMARY KEY,
        project_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        worker_id TEXT,
        claimed_at TEXT,
        created_at TEXT NOT NULL,
        claude_done INTEGER NOT NULL DEFAULT 0,
        claude_done_at TEXT
      );
    `);
  }

  close(): void {
    this.sqlite.close();
  }

  // ===========================================================================
  // Worker Operations
  // ===========================================================================

  registerWorker(id: string, name: string, pid?: number): Worker {
    const now = new Date().toISOString();

    this.db
      .insert(workers)
      .values({
        id,
        name,
        status: "IDLE",
        lastHeartbeat: now,
        pid: pid ?? null,
        createdAt: now,
      })
      .run();

    return {
      id,
      name,
      status: "IDLE",
      lastHeartbeat: now,
      pid: pid ?? null,
      createdAt: now,
    };
  }

  unregisterWorker(id: string): void {
    this.db.delete(workers).where(eq(workers.id, id)).run();
  }

  updateHeartbeat(id: string, pid?: number): Worker | null {
    const now = new Date().toISOString();

    const updates: Partial<WorkerRow> = { lastHeartbeat: now };
    if (pid !== undefined) {
      updates.pid = pid;
    }

    this.db.update(workers).set(updates).where(eq(workers.id, id)).run();

    return this.findWorkerById(id);
  }

  updateStatus(id: string, status: WorkerStatus): Worker | null {
    this.db.update(workers).set({ status }).where(eq(workers.id, id)).run();
    return this.findWorkerById(id);
  }

  findWorkerById(id: string): Worker | null {
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    return row ? this.mapWorkerRow(row) : null;
  }

  findAllWorkersWithHealth(
    thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  ): WorkerWithHealth[] {
    const rows = this.db.select().from(workers).all();
    const now = new Date();

    // Get current task for each worker
    const claims = this.db
      .select()
      .from(dispatchQueue)
      .where(sql`${dispatchQueue.status} = 'WORKING'`)
      .all();
    const workerTaskMap = new Map<string, string>();
    for (const claim of claims) {
      if (claim.workerId) {
        workerTaskMap.set(claim.workerId, claim.taskId);
      }
    }

    return rows.map((row) => {
      const worker = this.mapWorkerRow(row);
      return {
        ...worker,
        isAlive: isWorkerAlive(worker.lastHeartbeat, thresholdSeconds, now),
        heartbeatAge: getHeartbeatAge(worker.lastHeartbeat, now),
        currentTaskId: workerTaskMap.get(worker.id) ?? null,
      };
    });
  }

  getWorkerSummary(thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS): WorkerSummary {
    const workersWithHealth = this.findAllWorkersWithHealth(thresholdSeconds);
    const alive = workersWithHealth.filter((w) => w.isAlive);

    return {
      total: alive.length,
      idle: alive.filter((w) => w.status === "IDLE").length,
      working: alive.filter((w) => w.status === "WORKING").length,
      draining: alive.filter((w) => w.status === "DRAINING").length,
    };
  }

  getNextWorkerName(): string {
    const rows = this.db.select({ name: workers.name }).from(workers).all();

    // Extract numbers from existing names
    const usedNumbers = new Set<number>();
    for (const row of rows) {
      const match = row.name.match(/^worker-(\d+)$/);
      if (match?.[1]) {
        usedNumbers.add(parseInt(match[1], 10));
      }
    }

    // Find first available number
    let num = 1;
    while (usedNumbers.has(num)) {
      num++;
    }

    return `worker-${num}`;
  }

  cleanupDeadWorkers(thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS): number {
    const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    const result = this.db
      .delete(workers)
      .where(sql`${workers.lastHeartbeat} <= ${threshold}`)
      .run();

    return result.changes;
  }

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  enqueue(taskId: string, projectSlug: string): QueueEntry {
    const now = new Date().toISOString();

    // Check if already queued
    const existing = this.findByTaskId(taskId);
    if (existing) {
      return existing;
    }

    const entry: QueueEntry = {
      taskId,
      projectSlug,
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
        projectSlug: entry.projectSlug,
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
  ): QueueEntry | null {
    const now = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    // Find a claimable task:
    // 1. PENDING status, OR
    // 2. WORKING status but worker has stale heartbeat
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
          eq(dispatchQueue.status, "PENDING"),
          sql`${dispatchQueue.status} = 'WORKING' AND (${workers.id} IS NULL OR ${workers.lastHeartbeat} <= ${staleThreshold})`
        )
      )
      .limit(1)
      .get();

    if (!candidate) {
      return null;
    }

    // If reclaiming from a stale worker, kill the old worker process first
    if (candidate.status === "WORKING" && candidate.workerId) {
      this.killStaleWorkerProcess(candidate.workerId);
    }

    // Atomic claim
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
      // Lost the race
      return null;
    }

    return this.findByTaskId(candidate.taskId);
  }

  private killStaleWorkerProcess(workerId: string): boolean {
    const worker = this.db
      .select({ pid: workers.pid })
      .from(workers)
      .where(eq(workers.id, workerId))
      .get();

    if (!worker?.pid) {
      return false;
    }

    try {
      process.kill(worker.pid, "SIGTERM");
      return true;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH") {
        console.warn(`Failed to kill stale worker process (PID ${worker.pid}): ${errorCode}`);
      }
      return false;
    }
  }

  remove(taskId: string): void {
    this.db.delete(dispatchQueue).where(eq(dispatchQueue.taskId, taskId)).run();
  }

  findByTaskId(taskId: string): QueueEntry | null {
    const row = this.db.select().from(dispatchQueue).where(eq(dispatchQueue.taskId, taskId)).get();
    return row ? this.mapQueueRow(row) : null;
  }

  findClaimByWorker(workerId: string): QueueEntry | null {
    const row = this.db
      .select()
      .from(dispatchQueue)
      .where(eq(dispatchQueue.workerId, workerId))
      .get();
    return row ? this.mapQueueRow(row) : null;
  }

  findAllEntriesWithHealth(
    thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  ): QueueEntryWithHealth[] {
    const results = this.db
      .select({
        taskId: dispatchQueue.taskId,
        projectSlug: dispatchQueue.projectSlug,
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
      const entry = this.mapQueueRow({
        taskId: row.taskId,
        projectSlug: row.projectSlug,
        status: row.status,
        workerId: row.workerId,
        claimedAt: row.claimedAt,
        createdAt: row.createdAt,
        claudeDone: row.claudeDone,
        claudeDoneAt: row.claudeDoneAt,
      });

      let isStale = false;
      if (entry.status === "WORKING" && row.workerId) {
        if (!row.workerLastHeartbeat) {
          isStale = true;
        } else {
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

  getQueueStats(thresholdSeconds: number = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS): QueueStats {
    const entries = this.findAllEntriesWithHealth(thresholdSeconds);

    return {
      total: entries.length,
      unclaimed: entries.filter((e) => e.status === "PENDING").length,
      claimed: entries.filter((e) => e.status === "WORKING").length,
      stale: entries.filter((e) => e.isStale).length,
    };
  }

  setClaudeDone(taskId: string, workerId: string): QueueEntry | null {
    const now = new Date().toISOString();

    const existing = this.findByTaskId(taskId);
    if (!existing || existing.workerId !== workerId) {
      return null;
    }

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

  // ===========================================================================
  // Mapping Helpers
  // ===========================================================================

  private mapWorkerRow(row: WorkerRow): Worker {
    return {
      id: row.id,
      name: row.name,
      status: row.status as WorkerStatus,
      lastHeartbeat: row.lastHeartbeat,
      pid: row.pid,
      createdAt: row.createdAt,
    };
  }

  private mapQueueRow(row: DispatchQueueRow): QueueEntry {
    return {
      taskId: row.taskId,
      projectSlug: row.projectSlug,
      status: (row.status ?? "PENDING") as QueueEntryStatus,
      workerId: row.workerId,
      claimedAt: row.claimedAt,
      createdAt: row.createdAt,
      claudeDone: row.claudeDone ?? false,
      claudeDoneAt: row.claudeDoneAt ?? null,
    };
  }
}

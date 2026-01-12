/**
 * WorkerService - Application service for worker operations
 *
 * Orchestrates worker lifecycle operations including registration,
 * heartbeat updates, and status tracking.
 *
 * Follows Service Layer Pattern:
 * - Wraps WorkerRepository for all worker operations
 * - All worker access should go through this service
 */

import type { Worker, WorkerStatus, WorkerWithHealth } from "../domain/worker.js";
import type { DbSource } from "../domain/db-source.js";

/**
 * Error thrown when worker operation fails
 */
export class WorkerServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "ALREADY_EXISTS" | "INVALID_STATE" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "WorkerServiceError";
  }
}

/**
 * WorkerService - Orchestrates worker operations
 */
export class WorkerService {
  constructor(private readonly db: DbSource) {}

  /**
   * Get the next available worker name
   */
  getNextWorkerName(): string {
    return this.db.workers.getNextWorkerName();
  }

  /**
   * Register a new worker
   */
  register(workerId: string, workerName: string, pid: number): Worker {
    return this.db.workers.register(workerId, workerName, pid);
  }

  /**
   * Unregister a worker
   */
  unregister(workerId: string): void {
    this.db.workers.unregister(workerId);
  }

  /**
   * Update worker status
   */
  updateStatus(workerId: string, status: WorkerStatus): void {
    this.db.workers.updateStatus(workerId, status);
  }

  /**
   * Update worker heartbeat
   */
  updateHeartbeat(workerId: string, pid: number): void {
    this.db.workers.updateHeartbeat(workerId, pid);
  }

  /**
   * Find all workers with health status
   */
  findAllWithHealth(heartbeatThresholdSeconds?: number): WorkerWithHealth[] {
    return this.db.workers.findAllWithHealth(heartbeatThresholdSeconds);
  }

  /**
   * Find a worker by ID
   */
  findById(workerId: string): Worker | null {
    return this.db.workers.findById(workerId);
  }

  /**
   * Get worker by ID, throws if not found
   */
  getWorker(workerId: string): Worker {
    const worker = this.db.workers.findById(workerId);
    if (!worker) {
      throw new WorkerServiceError(`Worker not found: ${workerId}`, "NOT_FOUND");
    }
    return worker;
  }
}

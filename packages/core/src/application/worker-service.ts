/**
 * WorkerService - Application service for worker operations
 *
 * Orchestrates worker lifecycle operations including registration,
 * heartbeat updates, and status tracking.
 *
 * Follows Service Layer Pattern:
 * - Wraps WorkerQueueDb for all worker operations
 * - All worker access should go through this service
 */

import type { Worker, WorkerStatus, WorkerWithHealth } from "../domain/worker.js";
import type { WorkerQueueDb } from "../domain/worker-queue-db.js";

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
  constructor(private readonly workerQueueDb: WorkerQueueDb) {}

  /**
   * Get the next available worker name
   */
  getNextWorkerName(): string {
    return this.workerQueueDb.getNextWorkerName();
  }

  /**
   * Register a new worker
   */
  register(workerId: string, workerName: string, pid: number): Worker {
    return this.workerQueueDb.registerWorker(workerId, workerName, pid);
  }

  /**
   * Unregister a worker
   */
  unregister(workerId: string): void {
    this.workerQueueDb.unregisterWorker(workerId);
  }

  /**
   * Update worker status
   */
  updateStatus(workerId: string, status: WorkerStatus): void {
    this.workerQueueDb.updateStatus(workerId, status);
  }

  /**
   * Update worker heartbeat
   */
  updateHeartbeat(workerId: string, pid: number): void {
    this.workerQueueDb.updateHeartbeat(workerId, pid);
  }

  /**
   * Find all workers with health status
   */
  findAllWithHealth(heartbeatThresholdSeconds?: number): WorkerWithHealth[] {
    return this.workerQueueDb.findAllWorkersWithHealth(heartbeatThresholdSeconds);
  }

  /**
   * Find a worker by ID
   */
  findById(workerId: string): Worker | null {
    return this.workerQueueDb.findWorkerById(workerId);
  }

  /**
   * Get worker by ID, throws if not found
   */
  getWorker(workerId: string): Worker {
    const worker = this.workerQueueDb.findWorkerById(workerId);
    if (!worker) {
      throw new WorkerServiceError(`Worker not found: ${workerId}`, "NOT_FOUND");
    }
    return worker;
  }
}

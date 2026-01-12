/**
 * DispatchService - Application service for dispatch queue operations
 *
 * Orchestrates task dispatching to workers, including queue management,
 * task claiming, and worker coordination.
 *
 * Follows Service Layer Pattern:
 * - Wraps DispatchQueueRepository for all queue operations
 * - All dispatch queue access should go through this service
 */

import type {
  DispatchQueueEntry,
  DispatchQueueEntryWithHealth,
  QueueStats,
} from "../domain/worker.js";
import type { DbSource } from "../domain/db-source.js";

/**
 * Error thrown when dispatch operation fails
 */
export class DispatchServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "ALREADY_QUEUED"
      | "NOT_CLAIMED"
      | "INVALID_STATE" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "DispatchServiceError";
  }
}

/**
 * DispatchService - Orchestrates dispatch queue operations
 */
export class DispatchService {
  constructor(private readonly db: DbSource) {}

  /**
   * Add a task to the dispatch queue
   */
  enqueue(taskId: string): DispatchQueueEntry {
    return this.db.dispatchQueue.enqueue(taskId);
  }

  /**
   * Remove a task from the dispatch queue
   */
  remove(taskId: string): void {
    this.db.dispatchQueue.remove(taskId);
  }

  /**
   * Find a queue entry by task ID
   */
  findByTaskId(taskId: string): DispatchQueueEntry | null {
    return this.db.dispatchQueue.findByTaskId(taskId);
  }

  /**
   * Claim a task for a worker
   */
  claimTask(workerId: string, thresholdSeconds?: number): DispatchQueueEntry | null {
    return this.db.dispatchQueue.claimTask(workerId, thresholdSeconds);
  }

  /**
   * Find a claim by worker ID
   */
  findClaimByWorker(workerId: string): DispatchQueueEntry | null {
    return this.db.dispatchQueue.findClaimByWorker(workerId);
  }

  /**
   * Find all queue entries with health status
   */
  findAllWithHealth(heartbeatThresholdSeconds?: number): DispatchQueueEntryWithHealth[] {
    return this.db.dispatchQueue.findAllWithHealth(heartbeatThresholdSeconds);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(heartbeatThresholdSeconds?: number): QueueStats {
    return this.db.dispatchQueue.getQueueStats(heartbeatThresholdSeconds);
  }

  /**
   * Mark a task as done by Claude
   */
  setClaudeDone(taskId: string, workerId: string): DispatchQueueEntry | null {
    return this.db.dispatchQueue.setClaudeDone(taskId, workerId);
  }

  /**
   * Check if a task is queued
   */
  isQueued(taskId: string): boolean {
    return this.db.dispatchQueue.findByTaskId(taskId) !== null;
  }
}

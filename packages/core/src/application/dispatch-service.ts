/**
 * DispatchService - Application service for dispatch queue operations
 *
 * Orchestrates task dispatching to workers, including queue management,
 * task claiming, and worker coordination.
 *
 * Follows Service Layer Pattern:
 * - Wraps WorkerQueueDb for all queue operations
 * - All dispatch queue access should go through this service
 */

import type {
  WorkerQueueDb,
  QueueEntry,
  QueueEntryWithHealth,
  QueueStats,
} from "../domain/worker-queue-db.js";

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
  constructor(
    private readonly workerQueueDb: WorkerQueueDb,
    private readonly projectSlug: string
  ) {}

  /**
   * Add a task to the dispatch queue
   */
  enqueue(taskId: string): QueueEntry {
    return this.workerQueueDb.enqueue(taskId, this.projectSlug);
  }

  /**
   * Remove a task from the dispatch queue
   */
  remove(taskId: string): void {
    this.workerQueueDb.remove(taskId);
  }

  /**
   * Find a queue entry by task ID
   */
  findByTaskId(taskId: string): QueueEntry | null {
    return this.workerQueueDb.findByTaskId(taskId);
  }

  /**
   * Claim a task for a worker
   */
  claimTask(workerId: string, thresholdSeconds?: number): QueueEntry | null {
    return this.workerQueueDb.claimTask(workerId, thresholdSeconds);
  }

  /**
   * Find a claim by worker ID
   */
  findClaimByWorker(workerId: string): QueueEntry | null {
    return this.workerQueueDb.findClaimByWorker(workerId);
  }

  /**
   * Find all queue entries with health status
   */
  findAllWithHealth(heartbeatThresholdSeconds?: number): QueueEntryWithHealth[] {
    return this.workerQueueDb.findAllEntriesWithHealth(heartbeatThresholdSeconds);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(heartbeatThresholdSeconds?: number): QueueStats {
    return this.workerQueueDb.getQueueStats(heartbeatThresholdSeconds);
  }

  /**
   * Mark a task as done by Claude
   */
  setClaudeDone(taskId: string, workerId: string): QueueEntry | null {
    return this.workerQueueDb.setClaudeDone(taskId, workerId);
  }

  /**
   * Check if a task is queued
   */
  isQueued(taskId: string): boolean {
    return this.workerQueueDb.findByTaskId(taskId) !== null;
  }
}

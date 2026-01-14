/**
 * DispatchTool - Worker task dispatch operations
 *
 * Handles worker registration, task dispatch queue, and session management.
 * Uses the global WorkerQueueDb (~/.track/worker-queue.db).
 */

import type { WorkerQueueDb, TaskService } from "@dev-workflow/core";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS } from "@dev-workflow/core";

// =============================================================================
// Types
// =============================================================================

interface WorkerSummary {
  total: number;
  idle: number;
  working: number;
  draining: number;
}

interface WorkerInfo {
  id: string;
  name: string;
  status: string;
  isAlive: boolean;
  heartbeatAge: number;
  currentTaskId: string | null;
}

interface QueueEntry {
  taskId: string;
  status: string;
  workerId: string | null;
  workerName: string | null;
  claimedAt: string | null;
  isStale: boolean;
  createdAt: string;
}

interface QueueEntryWithWorker {
  queueEntry: QueueEntry;
  claimedByWorker: WorkerInfo | null;
}

export interface DispatchStatus {
  workers: WorkerInfo[];
  workerSummary: WorkerSummary;
  queue: QueueEntry[];
  queueStats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

export interface DispatchTaskInput {
  taskId: string;
}

export interface DispatchTaskResult {
  success: true;
  alreadyQueued: boolean;
  message: string;
  queueEntry: QueueEntry;
  claimedByWorker: WorkerInfo | null;
  workerSummary: WorkerSummary;
}

export interface EndWorkerSessionInput {
  workerId: string;
  taskId: string;
}

export interface EndWorkerSessionResult {
  terminated: true;
  alreadyDone: boolean;
  message: string;
}

// =============================================================================
// DispatchTool Class
// =============================================================================

export class DispatchTool {
  constructor(
    private readonly workerQueueDb: WorkerQueueDb,
    private readonly taskService: TaskService,
    private readonly projectSlug: string
  ) {}

  /**
   * Get full dispatch status - workers, queue, and stats
   */
  getDispatchStatus(): DispatchStatus {
    const workersWithHealth = this.workerQueueDb.findAllWorkersWithHealth(
      DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
    );

    const workers = workersWithHealth.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      isAlive: w.isAlive,
      heartbeatAge: w.heartbeatAge,
      currentTaskId: w.currentTaskId,
    }));

    const workerSummary = this.workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);

    const queueEntries = this.workerQueueDb.findAllEntriesWithHealth(
      DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
    );
    const queue = queueEntries.map((e) => ({
      taskId: e.taskId,
      status: e.status,
      workerId: e.workerId,
      workerName: e.workerName,
      claimedAt: e.claimedAt,
      isStale: e.isStale,
      createdAt: e.createdAt,
    }));

    const queueStats = this.workerQueueDb.getQueueStats(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);

    return { workers, workerSummary, queue, queueStats };
  }

  /**
   * Dispatch a task to the worker queue
   */
  dispatch(input: DispatchTaskInput): DispatchTaskResult {
    const { taskId } = input;

    // Verify task exists
    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Verify task is in a dispatchable state (BACKLOG or READY)
    if (task.status !== "BACKLOG" && task.status !== "READY") {
      throw new Error(
        `Task cannot be dispatched: status is ${task.status}. Only BACKLOG or READY tasks can be dispatched.`
      );
    }

    const workerSummary = this.getWorkerSummary();

    // Check if already queued
    const existing = this.workerQueueDb.findByTaskId(taskId);
    if (existing) {
      const { queueEntry, claimedByWorker } = this.getQueueEntryWithWorker(taskId);
      return {
        success: true,
        alreadyQueued: true,
        message: "Task was already in dispatch queue",
        queueEntry,
        claimedByWorker,
        workerSummary,
      };
    }

    // Add to queue
    this.workerQueueDb.enqueue(taskId, this.projectSlug);

    const { queueEntry, claimedByWorker } = this.getQueueEntryWithWorker(taskId);
    return {
      success: true,
      alreadyQueued: false,
      message: "Task added to dispatch queue. A worker will pick it up.",
      queueEntry,
      claimedByWorker,
      workerSummary,
    };
  }

  /**
   * End a worker session - signals Claude is done
   */
  endWorkerSession(input: EndWorkerSessionInput): EndWorkerSessionResult {
    const { workerId, taskId } = input;

    // Verify task exists
    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Find the queue entry
    const entry = this.workerQueueDb.findByTaskId(taskId);
    if (!entry) {
      throw new Error(
        `Task is not in the dispatch queue: ${taskId}. ` +
          "This may happen if the task was already removed (terminal state reached)."
      );
    }

    // Verify the workerId matches
    if (entry.workerId !== workerId) {
      throw new Error(
        `Worker ID mismatch. Queue entry belongs to worker ${entry.workerId}, ` +
          `but end_worker_session was called with worker ${workerId}.`
      );
    }

    // Check if already marked done
    if (entry.claudeDone) {
      return {
        terminated: true,
        alreadyDone: true,
        message: "Worker session was already ended. No further actions will be processed.",
      };
    }

    // Set the claudeDone flag
    const updated = this.workerQueueDb.setClaudeDone(taskId, workerId);
    if (!updated) {
      throw new Error("Failed to set claudeDone flag. The queue entry may have been modified.");
    }

    return {
      terminated: true,
      alreadyDone: false,
      message:
        "Worker session ended. No further actions will be processed. " +
        "The worker process will terminate shortly.",
    };
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private getWorkerSummary(): WorkerSummary {
    return this.workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
  }

  private getQueueEntryWithWorker(taskId: string): QueueEntryWithWorker {
    const entries = this.workerQueueDb.findAllEntriesWithHealth(
      DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
    );
    const entry = entries.find((e) => e.taskId === taskId);

    if (!entry) {
      throw new Error(`Queue entry not found for task: ${taskId}`);
    }

    const queueEntry: QueueEntry = {
      taskId: entry.taskId,
      status: entry.status,
      workerId: entry.workerId,
      workerName: entry.workerName,
      claimedAt: entry.claimedAt,
      isStale: entry.isStale,
      createdAt: entry.createdAt,
    };

    let claimedByWorker: WorkerInfo | null = null;
    if (entry.workerId) {
      const workers = this.workerQueueDb.findAllWorkersWithHealth(
        DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
      );
      const worker = workers.find((w) => w.id === entry.workerId);
      if (worker) {
        claimedByWorker = {
          id: worker.id,
          name: worker.name,
          status: worker.status,
          isAlive: worker.isAlive,
          heartbeatAge: worker.heartbeatAge,
          currentTaskId: worker.currentTaskId,
        };
      }
    }

    return { queueEntry, claimedByWorker };
  }
}

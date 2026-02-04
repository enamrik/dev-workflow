/**
 * getDispatchStatus - Get current dispatch system status
 *
 * Returns worker health, queue entries with staleness info, and summary
 * statistics. No input required - reads the full dispatch state.
 */

import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import type { WorkerSummary } from "@dev-workflow/dispatch/worker-queue-db.js";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS } from "@dev-workflow/dispatch/worker.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Types
// =============================================================================

export interface WorkerInfo {
  id: string;
  name: string;
  status: string;
  isAlive: boolean;
  heartbeatAge: number;
  currentTaskId: string | null;
}

export interface QueueEntryInfo {
  taskId: string;
  status: string;
  workerId: string | null;
  workerName: string | null;
  claimedAt: string | null;
  isStale: boolean;
  createdAt: string;
}

export interface DispatchStatus {
  workers: WorkerInfo[];
  workerSummary: WorkerSummary;
  queue: QueueEntryInfo[];
  queueStats: { total: number; unclaimed: number; claimed: number; stale: number };
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get the full dispatch system status.
 *
 * 1. Fetch all workers with health info
 * 2. Get worker summary counts
 * 3. Fetch all queue entries with health/staleness info
 * 4. Get queue statistics
 */
export function getDispatchStatus() {
  return Effect.gen(function* () {
    const workerQueueDb = yield* WorkerQueueDbTag;
    const threshold = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS;

    workerQueueDb.cleanupDeadWorkers();
    const workersWithHealth = workerQueueDb.findAllWorkersWithHealth(threshold);
    const workers: WorkerInfo[] = workersWithHealth.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      isAlive: w.isAlive,
      heartbeatAge: w.heartbeatAge,
      currentTaskId: w.currentTaskId,
    }));

    const workerSummary = workerQueueDb.getWorkerSummary(threshold);

    const entriesWithHealth = workerQueueDb.findAllEntriesWithHealth(threshold);
    const queue: QueueEntryInfo[] = entriesWithHealth.map((e) => ({
      taskId: e.taskId,
      status: e.status,
      workerId: e.workerId,
      workerName: e.workerName,
      claimedAt: e.claimedAt,
      isStale: e.isStale,
      createdAt: e.createdAt,
    }));

    const queueStats = workerQueueDb.getQueueStats(threshold);

    return { workers, workerSummary, queue, queueStats } satisfies DispatchStatus;
  });
}

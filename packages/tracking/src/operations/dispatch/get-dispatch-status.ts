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
import { DbSourceTag } from "../../data-access/db-source.js";
import type { DbSource } from "../../data-access/db-source.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Compact issue/task association inlined per worker / queue entry so callers
 * can see "which worker is on which issue/task" without a follow-up get_task.
 * All three fields are null when there is no resolvable task (idle worker, or
 * a task that no longer exists).
 */
interface CompactAssociation {
  issueNumber: number | null;
  taskNumber: number | null;
  taskTitle: string | null;
}

export interface WorkerInfo extends CompactAssociation {
  id: string;
  name: string;
  status: string;
  isAlive: boolean;
  heartbeatAge: number;
  currentTaskId: string | null;
}

export interface QueueEntryInfo extends CompactAssociation {
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
    const dbSource = yield* DbSourceTag;
    const threshold = DEFAULT_HEARTBEAT_THRESHOLD_SECONDS;

    const resolveAssociation = makeAssociationResolver(dbSource);

    workerQueueDb.cleanupDeadWorkers();
    const workersWithHealth = workerQueueDb.findAllWorkersWithHealth(threshold);
    const workers: WorkerInfo[] = workersWithHealth.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      isAlive: w.isAlive,
      heartbeatAge: w.heartbeatAge,
      currentTaskId: w.currentTaskId,
      ...resolveAssociation(w.currentTaskId),
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
      ...resolveAssociation(e.taskId),
    }));

    const queueStats = workerQueueDb.getQueueStats(threshold);

    return { workers, workerSummary, queue, queueStats } satisfies DispatchStatus;
  });
}

const NO_ASSOCIATION: CompactAssociation = {
  issueNumber: null,
  taskNumber: null,
  taskTitle: null,
};

/**
 * Build a taskId → compact association resolver backed by the global DbSource.
 *
 * Memoizes per call so a worker and the queue entry pointing at the same task
 * only hit the database once. A null taskId (idle worker) or an unknown task
 * resolves to the all-null association.
 */
function makeAssociationResolver(
  dbSource: DbSource
): (taskId: string | null) => CompactAssociation {
  const cache = new Map<string, CompactAssociation>();

  return (taskId: string | null): CompactAssociation => {
    if (taskId === null) return NO_ASSOCIATION;

    const cached = cache.get(taskId);
    if (cached !== undefined) return cached;

    const association = dbSource.findTaskAssociationById(taskId) ?? NO_ASSOCIATION;
    cache.set(taskId, association);
    return association;
  };
}

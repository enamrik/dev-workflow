/**
 * endWorkerSession - Signal that Claude is done with a dispatched task
 *
 * Sets the claudeDone flag on the queue entry so the worker process
 * can detect completion and terminate gracefully.
 */

import { z } from "zod";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const EndWorkerSessionSchema = z.object({
  workerId: z.string().min(1),
  taskId: z.string().min(1),
});
export type EndWorkerSessionInput = z.infer<typeof EndWorkerSessionSchema>;

export interface EndWorkerSessionResult {
  terminated: true;
  alreadyDone: boolean;
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * End a worker session for a dispatched task.
 *
 * 1. Validate input
 * 2. Verify task exists
 * 3. Find queue entry for task
 * 4. Verify workerId matches the claiming worker
 * 5. Check if already marked claudeDone
 * 6. Set claudeDone flag
 */
export function endWorkerSession(input: EndWorkerSessionInput) {
  return Effect.gen(function* () {
    const { workerId, taskId } = validateInput(EndWorkerSessionSchema, input);
    const workerQueueDb = yield* WorkerQueueDbTag;
    const taskDomainService = yield* TaskDomainService;

    // 1. Verify task exists
    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 2. Find queue entry
    const queueEntry = workerQueueDb.findByTaskId(taskId);
    if (!queueEntry) {
      throw new Error(`Task ${taskId} is not in the dispatch queue`);
    }

    // 3. Verify worker ownership
    if (queueEntry.workerId !== workerId) {
      throw new Error(
        `Worker ${workerId} does not own task ${taskId}. ` +
          `Claimed by: ${queueEntry.workerId ?? "no one"}`
      );
    }

    // 4. Check if already done
    if (queueEntry.claudeDone) {
      return {
        terminated: true as const,
        alreadyDone: true,
        message: "Worker session was already ended for this task",
      } satisfies EndWorkerSessionResult;
    }

    // 5. Set claudeDone flag
    const updated = workerQueueDb.setClaudeDone(taskId, workerId);
    if (!updated) {
      throw new Error(`Failed to set claudeDone for task ${taskId}`);
    }

    return {
      terminated: true as const,
      alreadyDone: false,
      message: "Worker session ended successfully",
    } satisfies EndWorkerSessionResult;
  });
}

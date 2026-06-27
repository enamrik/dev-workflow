/**
 * dispatchTask - Add a task to the dispatch queue for worker execution
 *
 * Validates the task exists and is in a dispatchable state (BACKLOG or READY),
 * then enqueues it. Returns existing entry if already queued (idempotent).
 */

import { z } from "zod";
import type { WorkerQueueDb, WorkerSummary } from "@dev-workflow/dispatch/worker-queue-db.js";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS } from "@dev-workflow/dispatch/worker.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { DbSourceTag } from "../../data-access/db-source.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const DispatchTaskSchema = z.object({
  taskId: z.string().min(1),
  projectSlug: z.string().min(1),
});
export type DispatchTaskInput = z.infer<typeof DispatchTaskSchema>;

export interface QueueEntryInfo {
  taskId: string;
  status: string;
  workerId: string | null;
  workerName: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  status: string;
}

export interface DispatchTaskResult {
  success: true;
  alreadyQueued: boolean;
  message: string;
  queueEntry: QueueEntryInfo;
  claimedByWorker: WorkerInfo | null;
  workerSummary: WorkerSummary;
}

// =============================================================================
// Helpers
// =============================================================================

function getQueueEntryWithWorker(
  workerQueueDb: WorkerQueueDb,
  taskId: string
): { entry: QueueEntryInfo; worker: WorkerInfo | null } | null {
  const queueEntry = workerQueueDb.findByTaskId(taskId);
  if (!queueEntry) {
    return null;
  }

  let worker: WorkerInfo | null = null;
  if (queueEntry.workerId) {
    const w = workerQueueDb.findWorkerById(queueEntry.workerId);
    if (w) {
      worker = { id: w.id, name: w.name, status: w.status };
    }
  }

  const entry: QueueEntryInfo = {
    taskId: queueEntry.taskId,
    status: queueEntry.status,
    workerId: queueEntry.workerId,
    workerName: worker?.name ?? null,
    claimedAt: queueEntry.claimedAt,
    createdAt: queueEntry.createdAt,
  };

  return { entry, worker };
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Dispatch a task to the worker queue.
 *
 * 1. Validate input
 * 2. Verify task exists and is in BACKLOG or READY status
 * 3. Return existing entry if already queued (idempotent)
 * 4. Verify all dependencies are satisfied before new enqueue
 * 5. Enqueue the task
 * 6. Return queue entry with worker info and summary
 */
export function dispatchTask(input: DispatchTaskInput) {
  return Effect.gen(function* () {
    const { taskId, projectSlug } = validateInput(DispatchTaskSchema, input);
    const workerQueueDb = yield* WorkerQueueDbTag;
    const taskDomainService = yield* TaskDomainService;
    const dbSource = yield* DbSourceTag;

    // 1. Verify task exists
    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    // Derive the task's TRUE owning-project slug from the task itself
    // (tasks → plans → issues → projects on the global DB). The caller-supplied
    // `projectSlug` is only the serving MCP server's cwd-resolved slug, which is
    // wrong for a cross-project dispatch — so prefer the derived slug and never
    // enqueue with the caller's slug when they disagree.
    const derivedSlug = dbSource.findProjectSlugByTaskId(taskId);
    const trueProjectSlug = derivedSlug ?? projectSlug;

    // 2. Verify task is in a dispatchable state
    if (task.status !== "BACKLOG" && task.status !== "READY") {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task cannot be dispatched: status is ${task.status}. Only BACKLOG or READY tasks can be dispatched.`
        )
      );
    }

    // 3. Check if already queued (idempotent — return existing entry before any further checks)
    const existing = getQueueEntryWithWorker(workerQueueDb, taskId);
    if (existing) {
      const workerSummary = workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
      return {
        success: true as const,
        alreadyQueued: true,
        message: existing.worker
          ? `Task already queued and claimed by ${existing.worker.name}`
          : "Task already queued, waiting for a worker",
        queueEntry: existing.entry,
        claimedByWorker: existing.worker,
        workerSummary,
      } satisfies DispatchTaskResult;
    }

    // 4. Verify all dependencies are satisfied before queuing a new entry
    const depsOk = yield* taskDomainService.areDependenciesSatisfied(task);
    if (!depsOk) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task cannot be dispatched: dependencies are not yet satisfied. Dispatch after all prerequisite tasks are COMPLETED or ABANDONED.`
        )
      );
    }

    // 5. Enqueue with the task's TRUE owning-project slug
    workerQueueDb.enqueue(taskId, trueProjectSlug);

    // 6. Build result with fresh queue entry info
    const result = getQueueEntryWithWorker(workerQueueDb, taskId);
    if (!result) {
      return yield* Effect.fail(
        new BusinessRuleError("Failed to enqueue task: entry not found after enqueue")
      );
    }

    const workerSummary = workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);

    return {
      success: true as const,
      alreadyQueued: false,
      message: "Task dispatched to queue",
      queueEntry: result.entry,
      claimedByWorker: result.worker,
      workerSummary,
    } satisfies DispatchTaskResult;
  });
}

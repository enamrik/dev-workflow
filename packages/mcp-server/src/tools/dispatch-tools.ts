/**
 * Dispatch-related MCP tools for worker task assignment
 */

import type { DispatchQueueRepository, TaskRepository, WorkerRepository } from "@dev-workflow/core";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Tool definitions for dispatch operations
 */
export const dispatchToolDefinitions: ToolDefinition[] = [
  {
    name: "dispatch_task",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Add a task to the dispatch queue for worker execution. Workers will poll and claim tasks from this queue. " +
      "Idempotent - returns existing entry if task is already queued. " +
      "Use this instead of load_task_session when you want a background worker to pick up the task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID to dispatch to workers",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "get_dispatch_status",
    description:
      "Get status of worker sessions and dispatch queue. " +
      "Workers are Claude instances polling for tasks - NOT git worktrees (use list_worktrees for that). " +
      "Returns: (1) all registered workers with status (IDLE/WORKING/DRAINING), isAlive, and currentTaskId; " +
      "(2) worker summary counts (total, idle, working, draining); " +
      "(3) dispatch queue entries showing which tasks are pending or being worked on; " +
      "(4) queue stats (total, unclaimed, claimed, stale).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "end_worker_session",
    description:
      "Signal that the Claude worker session is complete. This is the TERMINAL action for worker tasks - " +
      "nothing should be done after calling this. Sets the claudeDone flag which workers poll for before terminating. " +
      "Think of this like process.exit() - there is no 'after'. Must be called after complete_task or abandon_task_session.",
    inputSchema: {
      type: "object",
      properties: {
        workerId: {
          type: "string",
          description: "Worker UUID (provided in the worker prompt)",
        },
        taskId: {
          type: "string",
          description: "Task UUID that was being worked on",
        },
      },
      required: ["workerId", "taskId"],
    },
  },
];

/**
 * Context required for dispatch tool handlers
 */
export interface DispatchToolContext {
  dispatchQueueRepository: DispatchQueueRepository;
  taskRepository: TaskRepository;
  workerRepository: WorkerRepository;
}

/**
 * Handle dispatch_task tool
 *
 * Adds a task to the dispatch queue for worker execution.
 * Returns success if queued, or indicates if already queued.
 */
export function handleDispatchTask(
  context: DispatchToolContext,
  args: { taskId?: string }
): ToolResponse {
  const { taskId } = args;

  if (!taskId) {
    return errorResponse("taskId is required");
  }

  // Verify task exists
  const task = context.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Verify task is in a dispatchable state (BACKLOG or READY)
  if (task.status !== "BACKLOG" && task.status !== "READY") {
    return errorResponse(
      `Task cannot be dispatched: status is ${task.status}. Only BACKLOG or READY tasks can be dispatched.`
    );
  }

  // Get worker summary for the response (so Claude knows worker availability)
  const workerSummary = getWorkerSummary(context);

  // Check if already queued
  const existing = context.dispatchQueueRepository.findByTaskId(taskId);
  if (existing) {
    // Get the queue entry with health info and claiming worker if any
    const queueEntry = getQueueEntryWithWorker(context, taskId);

    return successResponse({
      success: true,
      alreadyQueued: true,
      message: "Task was already in dispatch queue",
      ...queueEntry,
      workerSummary,
    });
  }

  // Add to queue
  context.dispatchQueueRepository.enqueue(taskId);

  // Get the queue entry with health info
  const queueEntry = getQueueEntryWithWorker(context, taskId);

  return successResponse({
    success: true,
    alreadyQueued: false,
    message: "Task added to dispatch queue. A worker will pick it up.",
    ...queueEntry,
    workerSummary,
  });
}

/**
 * Worker summary counts - alive workers only
 */
interface WorkerSummary {
  total: number;
  idle: number;
  working: number;
  draining: number;
}

/**
 * Queue entry with optional claiming worker - for dispatch_task response
 */
interface QueueEntryWithWorker {
  queueEntry: {
    taskId: string;
    status: string;
    workerId: string | null;
    workerName: string | null;
    claimedAt: string | null;
    isStale: boolean;
    createdAt: string;
  };
  claimedByWorker: {
    id: string;
    name: string;
    status: string;
    isAlive: boolean;
    heartbeatAge: number;
    currentTaskId: string | null;
  } | null;
}

/**
 * Get worker summary counts (alive workers only)
 */
function getWorkerSummary(context: DispatchToolContext): WorkerSummary {
  const workersWithHealth = context.workerRepository.findAllWithHealth(
    DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  );
  const aliveWorkers = workersWithHealth.filter((w) => w.isAlive);
  return {
    total: aliveWorkers.length,
    idle: aliveWorkers.filter((w) => w.status === "IDLE").length,
    working: aliveWorkers.filter((w) => w.status === "WORKING").length,
    draining: aliveWorkers.filter((w) => w.status === "DRAINING").length,
  };
}

/**
 * Get queue entry for a task with the claiming worker if any
 */
function getQueueEntryWithWorker(
  context: DispatchToolContext,
  taskId: string
): QueueEntryWithWorker {
  const entries = context.dispatchQueueRepository.findAllWithHealth(
    DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  );
  const entry = entries.find((e) => e.taskId === taskId);

  if (!entry) {
    throw new Error(`Queue entry not found for task: ${taskId}`);
  }

  const queueEntry = {
    taskId: entry.taskId,
    status: entry.status,
    workerId: entry.workerId,
    workerName: entry.workerName,
    claimedAt: entry.claimedAt,
    isStale: entry.isStale,
    createdAt: entry.createdAt,
  };

  // If claimed, get the worker details
  let claimedByWorker = null;
  if (entry.workerId) {
    const workers = context.workerRepository.findAllWithHealth(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
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

/**
 * Full dispatch status - returned by get_dispatch_status
 */
interface DispatchStatus {
  workers: Array<{
    id: string;
    name: string;
    status: string;
    isAlive: boolean;
    heartbeatAge: number;
    currentTaskId: string | null;
  }>;
  workerSummary: {
    total: number;
    idle: number;
    working: number;
    draining: number;
  };
  queue: Array<{
    taskId: string;
    status: string;
    workerId: string | null;
    workerName: string | null;
    claimedAt: string | null;
    isStale: boolean;
    createdAt: string;
  }>;
  queueStats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

/**
 * Get full dispatch status - workers, queue, and stats
 * Used by both dispatch_task and get_dispatch_status for consistency
 */
function getDispatchStatus(context: DispatchToolContext): DispatchStatus {
  const workersWithHealth = context.workerRepository.findAllWithHealth(
    DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  );

  // Build workers list
  const workers = workersWithHealth.map((w) => ({
    id: w.id,
    name: w.name,
    status: w.status,
    isAlive: w.isAlive,
    heartbeatAge: w.heartbeatAge,
    currentTaskId: w.currentTaskId,
  }));

  // Calculate worker summary (only alive workers)
  const aliveWorkers = workersWithHealth.filter((w) => w.isAlive);
  const workerSummary = {
    total: aliveWorkers.length,
    idle: aliveWorkers.filter((w) => w.status === "IDLE").length,
    working: aliveWorkers.filter((w) => w.status === "WORKING").length,
    draining: aliveWorkers.filter((w) => w.status === "DRAINING").length,
  };

  // Get dispatch queue
  const queueEntries = context.dispatchQueueRepository.findAllWithHealth(
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

  // Queue stats
  const queueStats = context.dispatchQueueRepository.getQueueStats(
    DEFAULT_HEARTBEAT_THRESHOLD_SECONDS
  );

  return { workers, workerSummary, queue, queueStats };
}

/**
 * Handle get_dispatch_status tool
 *
 * Returns all registered workers with their status and health information.
 * Includes current task if the worker is working on one.
 * Also includes the dispatch queue so Claude can verify tasks are queued.
 */
export function handleGetDispatchStatus(context: DispatchToolContext): ToolResponse {
  return successResponse(getDispatchStatus(context));
}

/**
 * Handle end_worker_session tool
 *
 * Signals that Claude is done with the worker session.
 * Sets the claudeDone flag on the dispatch queue entry.
 * This is the TERMINAL action - nothing happens after this.
 */
export function handleEndWorkerSession(
  context: DispatchToolContext,
  args: { workerId?: string; taskId?: string }
): ToolResponse {
  const { workerId, taskId } = args;

  if (!workerId) {
    return errorResponse("workerId is required");
  }

  if (!taskId) {
    return errorResponse("taskId is required");
  }

  // Verify task exists
  const task = context.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Find the queue entry
  const entry = context.dispatchQueueRepository.findByTaskId(taskId);
  if (!entry) {
    return errorResponse(
      `Task is not in the dispatch queue: ${taskId}. ` +
        "This may happen if the task was already removed (terminal state reached)."
    );
  }

  // Verify the workerId matches
  if (entry.workerId !== workerId) {
    return errorResponse(
      `Worker ID mismatch. Queue entry belongs to worker ${entry.workerId}, ` +
        `but end_worker_session was called with worker ${workerId}.`
    );
  }

  // Check if already marked done
  if (entry.claudeDone) {
    return successResponse({
      terminated: true,
      alreadyDone: true,
      message: "Worker session was already ended. No further actions will be processed.",
    });
  }

  // Set the claudeDone flag
  const updated = context.dispatchQueueRepository.setClaudeDone(taskId, workerId);
  if (!updated) {
    return errorResponse("Failed to set claudeDone flag. The queue entry may have been modified.");
  }

  return successResponse({
    terminated: true,
    alreadyDone: false,
    message:
      "Worker session ended. No further actions will be processed. " +
      "The worker process will terminate shortly.",
  });
}

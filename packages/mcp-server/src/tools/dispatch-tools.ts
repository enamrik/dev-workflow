/**
 * Dispatch-related MCP tools for worker task assignment
 *
 * These tools use the global WorkerQueueDb (~/.track/worker-queue.db) for
 * worker registration and task dispatch. This is separate from the tracking
 * database to allow workers to run from any directory.
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import type { WorkerQueueDb } from "@dev-workflow/core";
import { DEFAULT_HEARTBEAT_THRESHOLD_SECONDS } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import { createMcpHandler, createNoArgsHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";
import {
  DispatchTaskSchema,
  EndWorkerSessionSchema,
  type DispatchTaskArgs,
  type EndWorkerSessionArgs,
} from "./schemas.js";

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
      "Think of this like process.exit() - there is no 'after'. Must be called after complete_task or abandon_task.",
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

// =============================================================================
// Helper Types
// =============================================================================

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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get worker summary counts (alive workers only)
 */
function getWorkerSummary(workerQueueDb: WorkerQueueDb): WorkerSummary {
  return workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
}

/**
 * Get queue entry for a task with the claiming worker if any
 */
function getQueueEntryWithWorker(
  workerQueueDb: WorkerQueueDb,
  taskId: string
): QueueEntryWithWorker {
  const entries = workerQueueDb.findAllEntriesWithHealth(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
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
    const workers = workerQueueDb.findAllWorkersWithHealth(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
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
 * Get full dispatch status - workers, queue, and stats
 * Used by both dispatch_task and get_dispatch_status for consistency
 */
function getDispatchStatus(workerQueueDb: WorkerQueueDb): DispatchStatus {
  const workersWithHealth = workerQueueDb.findAllWorkersWithHealth(
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

  // Get worker summary (only alive workers)
  const workerSummary = workerQueueDb.getWorkerSummary(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);

  // Get dispatch queue
  const queueEntries = workerQueueDb.findAllEntriesWithHealth(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);
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
  const queueStats = workerQueueDb.getQueueStats(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS);

  return { workers, workerSummary, queue, queueStats };
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle dispatch_task tool call
 *
 * Adds a task to the dispatch queue for worker execution.
 * Returns success if queued, or indicates if already queued.
 */
function dispatchTaskHandler(
  args: unknown,
  {
    workerQueueDb,
    taskService,
    projectSlug,
  }: Pick<McpCradle, "workerQueueDb" | "taskService" | "projectSlug">
): ToolResponse {
  const validation = validateToolArgs<DispatchTaskArgs>(DispatchTaskSchema, args);
  if (!validation.success) return validation.response;

  const { taskId } = validation.data;

  // Verify task exists
  const task = taskService.findById(taskId);
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
  const workerSummary = getWorkerSummary(workerQueueDb);

  // Check if already queued
  const existing = workerQueueDb.findByTaskId(taskId);
  if (existing) {
    // Get the queue entry with health info and claiming worker if any
    const queueEntry = getQueueEntryWithWorker(workerQueueDb, taskId);

    return successResponse({
      success: true,
      alreadyQueued: true,
      message: "Task was already in dispatch queue",
      ...queueEntry,
      workerSummary,
    });
  }

  // Add to queue with projectSlug for worker to resolve the tracking database
  workerQueueDb.enqueue(taskId, projectSlug);

  // Get the queue entry with health info
  const queueEntry = getQueueEntryWithWorker(workerQueueDb, taskId);

  return successResponse({
    success: true,
    alreadyQueued: false,
    message: "Task added to dispatch queue. A worker will pick it up.",
    ...queueEntry,
    workerSummary,
  });
}

/**
 * Handle get_dispatch_status tool call
 *
 * Returns all registered workers with their status and health information.
 * Includes current task if the worker is working on one.
 * Also includes the dispatch queue so Claude can verify tasks are queued.
 */
function getDispatchStatusHandler({
  workerQueueDb,
}: Pick<McpCradle, "workerQueueDb">): ToolResponse {
  return successResponse(getDispatchStatus(workerQueueDb));
}

/**
 * Handle end_worker_session tool call
 *
 * Signals that Claude is done with the worker session.
 * Sets the claudeDone flag on the dispatch queue entry.
 * This is the TERMINAL action - nothing happens after this.
 */
function endWorkerSessionHandler(
  args: unknown,
  { workerQueueDb, taskService }: Pick<McpCradle, "workerQueueDb" | "taskService">
): ToolResponse {
  const validation = validateToolArgs<EndWorkerSessionArgs>(EndWorkerSessionSchema, args);
  if (!validation.success) return validation.response;

  const { workerId, taskId } = validation.data;

  // Verify task exists
  const task = taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Find the queue entry
  const entry = workerQueueDb.findByTaskId(taskId);
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
  const updated = workerQueueDb.setClaudeDone(taskId, workerId);
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

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleDispatchTask = createMcpHandler(dispatchTaskHandler);
export const handleGetDispatchStatus = createNoArgsHandler(getDispatchStatusHandler);
export const handleEndWorkerSession = createMcpHandler(endWorkerSessionHandler);

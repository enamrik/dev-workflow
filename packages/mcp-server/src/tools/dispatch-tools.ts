/**
 * Dispatch-related MCP tools for worker task assignment
 */

import type { DispatchQueueRepository, TaskRepository } from "@dev-workflow/core";
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

  // Check if already queued
  const existing = context.dispatchQueueRepository.findByTaskId(taskId);
  if (existing) {
    return successResponse({
      success: true,
      alreadyQueued: true,
      entry: existing,
      message: "Task was already in dispatch queue",
    });
  }

  // Add to queue
  const entry = context.dispatchQueueRepository.enqueue(taskId);

  return successResponse({
    success: true,
    alreadyQueued: false,
    entry,
    message: "Task added to dispatch queue. A worker will pick it up.",
  });
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

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

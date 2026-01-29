/**
 * Dispatch tool definitions and handlers
 *
 * Pattern:
 * - Tool definitions describe the MCP interface
 * - Handlers are thin wrappers: validate + delegate + return success
 * - createMcpHandler wraps with error handling
 */

import type { ToolDefinition } from "./types.js";
import { successResponse } from "./types.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import { DispatchTaskSchema, EndWorkerSessionSchema } from "./schemas.js";
import type { DispatchTool } from "./dispatch-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

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
// Handlers
// =============================================================================

export const handleDispatchTask = createMcpHandler(
  (args: unknown, { dispatchTool }: { dispatchTool: DispatchTool }) => {
    const validated = validateSchema(DispatchTaskSchema, args);
    return successResponse(dispatchTool.dispatch(validated));
  }
);

export const handleGetDispatchStatus = createMcpHandler(
  (_args: unknown, { dispatchTool }: { dispatchTool: DispatchTool }) => {
    return successResponse(dispatchTool.getDispatchStatus());
  }
);

export const handleEndWorkerSession = createMcpHandler(
  (args: unknown, { dispatchTool }: { dispatchTool: DispatchTool }) => {
    const validated = validateSchema(EndWorkerSessionSchema, args);
    return successResponse(dispatchTool.endWorkerSession(validated));
  }
);

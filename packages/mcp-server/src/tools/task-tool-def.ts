/**
 * Task Tool Handlers
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler validates args and delegates to TaskTool.
 *
 * Tool definitions are in tool-definitions.ts (generated from Zod schemas).
 */

import { successResponse } from "./types.js";
import {
  LoadTaskSessionSchema,
  AbandonTaskSchema,
  GetTaskSchema,
  ListAvailableTasksSchema,
  DeleteTaskSchema,
  UpdateTaskSchema,
  GetTaskExecutionPromptSchema,
  LogTaskProgressSchema,
  GetTaskExecutionLogSchema,
  CheckTaskConflictsSchema,
} from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { TaskTool } from "./task-tool.js";

// =============================================================================
// Handler Implementations
// =============================================================================

export const handleLoadTaskSession = createMcpHandler(
  async (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(LoadTaskSessionSchema, args);
    const result = await taskTool.loadTaskSession(validated);
    return successResponse(result);
  }
);

export const handleAbandonTask = createMcpHandler(
  async (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(AbandonTaskSchema, args);
    const result = await taskTool.abandonTask(validated);
    return successResponse(result);
  }
);

export const handleGetTask = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(GetTaskSchema, args);
    const result = taskTool.getTask(validated);
    return successResponse(result);
  }
);

export const handleListAvailableTasks = createMcpHandler(
  async (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(ListAvailableTasksSchema, args);
    const result = await taskTool.listAvailableTasks(validated);
    return successResponse(result);
  }
);

export const handleDeleteTask = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(DeleteTaskSchema, args);
    const result = taskTool.deleteTask(validated);
    return successResponse(result);
  }
);

export const handleUpdateTask = createMcpHandler(
  async (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(UpdateTaskSchema, args);
    const result = await taskTool.updateTask(validated);
    return successResponse(result);
  }
);

export const handleGetTaskExecutionPrompt = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(GetTaskExecutionPromptSchema, args);
    const result = taskTool.getTaskExecutionPrompt(validated);
    return successResponse(result);
  }
);

export const handleLogTaskProgress = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(LogTaskProgressSchema, args);
    const result = taskTool.logTaskProgress(validated);
    return successResponse(result);
  }
);

export const handleGetTaskExecutionLog = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(GetTaskExecutionLogSchema, args);
    const result = taskTool.getTaskExecutionLog(validated);
    return successResponse(result);
  }
);

export const handleCheckTaskConflicts = createMcpHandler(
  (args: unknown, { taskTool }: { taskTool: TaskTool }) => {
    const validated = validateSchema(CheckTaskConflictsSchema, args);
    const result = taskTool.checkTaskConflicts(validated);
    return successResponse(result);
  }
);

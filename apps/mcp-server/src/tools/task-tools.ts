/**
 * Task Tool Schemas and Handlers
 *
 * Colocated Zod schemas with their MCP handlers.
 * Each handler validates via createMcpHandler(schema, handler).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import {
  loadTaskSession,
  abandonTask,
  getTask,
  listAvailableTasks,
  deleteTask,
  updateTask,
  getTaskExecutionPrompt,
  logTaskProgress,
  getTaskExecutionLog,
  checkTaskConflicts,
} from "@dev-workflow/tracking";

// =============================================================================
// Local Enums
// =============================================================================

const ExecutionModeEnum = z.enum(["isolated", "branch", "main"]);

// =============================================================================
// Schemas
// =============================================================================

export const LoadTaskSessionSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  mode: ExecutionModeEnum.optional()
    .default("isolated")
    .describe(
      "Execution mode. ALWAYS use 'isolated' (default) unless user explicitly requests otherwise. 'branch': only if user says 'branch mode' or 'no worktree'. 'main': only if user explicitly says 'on main', 'main mode', or 'skip PR'."
    ),
  workerId: z
    .string()
    .optional()
    .describe(
      "Worker UUID. When provided, enforces isolated mode - fails if mode is not 'isolated'. Workers MUST pass their workerId to prevent accidental use of non-isolated modes."
    ),
});

export const AbandonTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  reason: z.string().optional().describe("Reason for abandonment"),
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass session ownership validation. Use when task state has drifted (e.g., session expired but task is still IN_PROGRESS). Requires user confirmation before use."
    ),
});

export const GetTaskSchema = z.object({
  taskId: z.string().optional().describe("Task UUID"),
  taskNumber: z.number().optional().describe("Task number within the issue (e.g., 1, 2, 3)"),
  issueNumber: z.number().optional().describe("Issue number (required when using taskNumber)"),
});

export const ListAvailableTasksSchema = z.object({
  planId: z.string().optional().describe("Filter by plan UUID"),
  issueNumber: z.number().optional().describe("Filter by issue number"),
});

export const DeleteTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

// Use .strict() on the full object since all properties are explicitly defined
export const UpdateTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  title: z.string().optional().describe("New task title"),
  description: z.string().optional().describe("New task description"),
  acceptanceCriteria: z.array(z.string()).optional().describe("New acceptance criteria"),
  estimatedMinutes: z.number().optional().describe("Estimated time in minutes"),
  implementationPlan: z
    .string()
    .optional()
    .describe(
      "Technical implementation details for task execution (e.g., specific patterns to use, file locations)"
    ),
  labels: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe(
      'Task labels as key-value pairs. Empty string = simple tag, non-empty = value. To remove a label, set its value to null. Example: { "urgent": "", "product": "Case Workflow" }'
    ),
});

export const GetTaskExecutionPromptSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const LogTaskProgressSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Session ID executing the task"),
  message: z.string().describe("What was done (e.g., 'Created user model in src/models/user.ts')"),
  filesModified: z.array(z.string()).optional().describe("Optional list of files touched"),
});

export const GetTaskExecutionLogSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const CheckTaskConflictsSchema = z.object({
  taskId: z.string().describe("Task UUID to check for conflicts"),
});

// =============================================================================
// Handler Implementations
// =============================================================================

export const handleLoadTaskSession = createMcpHandler({
  schema: LoadTaskSessionSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* loadTaskSession(args));
    }),
});

export const handleAbandonTask = createMcpHandler({
  schema: AbandonTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* abandonTask(args));
    }),
});

export const handleGetTask = createMcpHandler({
  schema: GetTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getTask(args));
    }),
});

export const handleListAvailableTasks = createMcpHandler({
  schema: ListAvailableTasksSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* listAvailableTasks(args));
    }),
});

export const handleDeleteTask = createMcpHandler({
  schema: DeleteTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* deleteTask(args));
    }),
});

export const handleUpdateTask = createMcpHandler({
  schema: UpdateTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* updateTask(args));
    }),
});

export const handleGetTaskExecutionPrompt = createMcpHandler({
  schema: GetTaskExecutionPromptSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getTaskExecutionPrompt(args));
    }),
});

export const handleLogTaskProgress = createMcpHandler({
  schema: LogTaskProgressSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* logTaskProgress(args));
    }),
});

export const handleGetTaskExecutionLog = createMcpHandler({
  schema: GetTaskExecutionLogSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getTaskExecutionLog(args));
    }),
});

export const handleCheckTaskConflicts = createMcpHandler({
  schema: CheckTaskConflictsSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* checkTaskConflicts(args));
    }),
});

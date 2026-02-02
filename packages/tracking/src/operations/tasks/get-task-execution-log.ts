/**
 * getTaskExecutionLog - Retrieve execution logs for a task
 *
 * Returns all execution log entries recorded during task execution,
 * including session IDs, messages, and files modified.
 */

import { z } from "zod";
import { TaskService } from "../../domain/tasks/task-service.js";
import { DbClientTag } from "../../data-access/db-client.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const getTaskExecutionLogSchema = z.object({
  taskId: z.string().min(1),
});

export type GetTaskExecutionLogInput = z.infer<typeof getTaskExecutionLogSchema>;

// =============================================================================
// Types
// =============================================================================

export interface GetTaskExecutionLogResult {
  success: boolean;
  taskId: string;
  entries: Array<{
    id: string;
    sessionId: string;
    message: string;
    filesModified?: string[] | null;
    createdAt: string;
  }>;
}

// =============================================================================
// Operation
// =============================================================================

export function getTaskExecutionLog(input: GetTaskExecutionLogInput) {
  return Effect.gen(function* () {
    const { taskId } = validateInput(getTaskExecutionLogSchema, input);
    const taskService = yield* TaskService;
    const dbClient = yield* DbClientTag;

    // Verify task exists
    const task = yield* taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get all execution log entries for this task
    const logs = yield* dbClient.executionLogs.findByTaskId(taskId);

    const entries = logs.map((log) => ({
      id: log.id,
      sessionId: log.sessionId,
      message: log.message,
      filesModified: log.filesModified,
      createdAt: log.createdAt,
    }));

    return {
      success: true,
      taskId,
      entries,
    } satisfies GetTaskExecutionLogResult;
  });
}

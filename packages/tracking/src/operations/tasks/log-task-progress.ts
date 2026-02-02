/**
 * logTaskProgress - Create an execution log entry for a task
 *
 * Records progress during task execution. Used for audit trail
 * and conflict detection (via filesModified).
 */

import { z } from "zod";
import { TaskService } from "../../domain/tasks/task-service.js";
import { DbClientTag } from "../../data-access/db-client.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const logTaskProgressSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  message: z.string().min(1),
  filesModified: z.array(z.string()).optional(),
});

export type LogTaskProgressInput = z.infer<typeof logTaskProgressSchema>;

// =============================================================================
// Types
// =============================================================================

export interface LogTaskProgressResult {
  success: boolean;
  logId: string;
  taskId: string;
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function logTaskProgress(input: LogTaskProgressInput) {
  return Effect.gen(function* () {
    const { taskId, sessionId, message, filesModified } = validateInput(
      logTaskProgressSchema,
      input
    );
    const taskService = yield* TaskService;
    const dbClient = yield* DbClientTag;

    // Verify task exists
    const task = yield* taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Insert execution log entry
    const log = yield* dbClient.executionLogs.create({
      taskId,
      sessionId,
      message,
      filesModified: filesModified || undefined,
    });

    return {
      success: true,
      logId: log.id,
      taskId,
      message,
    } satisfies LogTaskProgressResult;
  });
}

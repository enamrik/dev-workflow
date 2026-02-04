/**
 * logTaskProgress - Create an execution log entry for a task
 *
 * Records progress during task execution. Used for audit trail
 * and conflict detection (via filesModified).
 */

import { z } from "zod";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { DbClientTag } from "../../data-access/db-client.js";
import { EntityNotFoundError } from "../../domain/errors.js";
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
    const taskDomainService = yield* TaskDomainService;
    const dbClient = yield* DbClientTag;

    // Verify task exists
    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
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

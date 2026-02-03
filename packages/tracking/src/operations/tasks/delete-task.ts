/**
 * deleteTask - Soft-delete a task
 *
 * Delegates to TaskDomainService which validates the task is in PLANNED status.
 * Only PLANNED tasks can be deleted; use abandon for tasks past PLANNED.
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const deleteTaskSchema = z.object({
  taskId: z.string().min(1),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

// =============================================================================
// Types
// =============================================================================

export interface DeleteTaskResult {
  success: boolean;
  task: Task;
}

// =============================================================================
// Operation
// =============================================================================

export function deleteTask(input: DeleteTaskInput) {
  return Effect.gen(function* () {
    const { taskId } = validateInput(deleteTaskSchema, input);
    const taskDomainService = yield* TaskDomainService;

    const task = yield* taskDomainService.deleteTask(taskId, "claude-agent");

    return {
      success: true,
      task,
    } satisfies DeleteTaskResult;
  });
}

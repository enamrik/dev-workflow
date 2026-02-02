/**
 * abandonTask - Abandon a task with cleanup info
 *
 * Uses domain service for the status transition. External cleanup
 * (worktree, PR, project board) is optional via context.
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const abandonTaskSchema = z.object({
  projectSlug: z.string().min(1),
  taskId: z.string().min(1),
  reason: z.string().optional(),
  abandonedBy: z.string().optional(),
});

export type AbandonTaskInput = z.infer<typeof abandonTaskSchema>;

// =============================================================================
// Types
// =============================================================================

export interface AbandonTaskResult {
  task: Task;
  previousStatus: string;
}

// =============================================================================
// Operation
// =============================================================================

export function abandonTask(input: AbandonTaskInput) {
  return Effect.gen(function* () {
    const {
      projectSlug,
      taskId,
      reason = "Task abandoned",
      abandonedBy = "system",
    } = validateInput(abandonTaskSchema, input);
    const domain = yield* DomainExecutorFactory;
    const { tasks } = yield* domain.forProject(projectSlug);

    const task = yield* tasks.getOrThrow(taskId);
    if (task.isTerminal) {
      return yield* Effect.fail(
        new BusinessRuleError(`Task is already in terminal state: ${task.status}`)
      );
    }

    const previousStatus = task.status;
    const updatedTask = yield* tasks.abandon(taskId, reason, abandonedBy);

    return { task: updatedTask, previousStatus };
  });
}

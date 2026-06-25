/**
 * abandonTask - Abandon a task with worktree/branch cleanup
 *
 * Coordinates between GitWorktreeService (worktree/branch removal)
 * and TaskDomainService (DB record cleanup, status transition).
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const abandonTaskSchema = z.object({
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
      taskId,
      reason = "Task abandoned",
      abandonedBy = "system",
    } = validateInput(abandonTaskSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const gitWorktreeService = yield* GitWorktreeService;

    const task = yield* taskDomainService.getOrThrow(taskId);
    if (task.isTerminal) {
      return yield* Effect.fail(
        new BusinessRuleError(`Task is already in terminal state: ${task.status}`)
      );
    }

    // Clean up worktree (all tasks use isolated mode with worktrees)
    if (task.worktreePath) {
      yield* Effect.catchAll(gitWorktreeService.removeWorktree(task.worktreePath, true), () =>
        Effect.succeed(console.warn(`Failed to cleanup worktree: ${task.worktreePath}`))
      );
      yield* taskDomainService.clearWorktreeInfo(taskId);
    }

    const previousStatus = task.status;
    const updatedTask = yield* taskDomainService.abandon(taskId, reason, abandonedBy);

    return { task: updatedTask, previousStatus };
  });
}

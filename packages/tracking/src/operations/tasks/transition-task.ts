/**
 * transitionTask - Transition a task to a new status
 *
 * Delegates to TaskDomainService.transitionTo() which handles validation,
 * dispatch, and the parent-issue activation side-effect.
 */

import { z } from "zod";
import type { Task, TaskStatus } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const transitionTaskSchema = z.object({
  projectSlug: z.string().min(1),
  taskId: z.string().min(1),
  toStatus: z.enum([
    "PLANNED",
    "BACKLOG",
    "READY",
    "IN_PROGRESS",
    "PR_REVIEW",
    "COMPLETED",
    "ABANDONED",
  ]),
  changedBy: z.string().optional(),
});

export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>;

// =============================================================================
// Types
// =============================================================================

export interface TransitionTaskResult {
  task: Task;
  previousStatus: string;
}

// =============================================================================
// Operation
// =============================================================================

export function transitionTask(input: TransitionTaskInput) {
  return Effect.gen(function* () {
    const {
      projectSlug,
      taskId,
      toStatus: toStatusRaw,
      changedBy = "system",
    } = validateInput(transitionTaskSchema, input);
    const domain = yield* DomainExecutorFactory;
    const { tasks } = yield* domain.forProject(projectSlug);

    return yield* tasks.transitionTo(taskId, toStatusRaw as TaskStatus, changedBy);
  });
}

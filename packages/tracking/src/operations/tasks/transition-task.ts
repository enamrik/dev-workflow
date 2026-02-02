/**
 * transitionTask - Transition a task to a new status
 *
 * Validates the transition, dispatches to the appropriate domain service method,
 * and handles the side-effect of activating a PLANNED parent issue when a
 * task moves to BACKLOG.
 */

import { z } from "zod";
import type { Task, TaskStatus } from "../../domain/tasks/task.js";
import type { IssueStatus } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError } from "../../domain/errors.js";
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
    const toStatus = toStatusRaw as TaskStatus;
    const domain = yield* DomainExecutorFactory;
    const { tasks, plans, issues } = yield* domain.forProject(projectSlug);

    const task = yield* tasks.getOrThrow(taskId);
    const previousStatus = task.status;

    // Special: IN_PROGRESS → PR_REVIEW requires a PR (use canSubmitForReview for full check)
    if (toStatus === "PR_REVIEW") {
      const reviewCheck = task.canSubmitForReview();
      if (!reviewCheck.allowed) {
        return yield* Effect.fail(new BusinessRuleError(reviewCheck.reason!));
      }
    } else {
      // Validate the transition is allowed
      const check = task.checkTransition(toStatus);
      if (!check.allowed) {
        return yield* Effect.fail(new BusinessRuleError(check.reason!));
      }
    }

    // Side-effect: PLANNED → BACKLOG activates the parent issue
    if (task.status === "PLANNED" && toStatus === "BACKLOG") {
      const plan = yield* plans.findById(task.planId);
      if (plan) {
        const issue = yield* issues.findById(plan.issueId);
        if (issue && issue.isInPlanning) {
          yield* issues.updateStatus(issue.id, "OPEN" as IssueStatus);
        }
      }
    }

    // Dispatch to the appropriate domain service method
    let updatedTask: Task;
    switch (toStatus) {
      case "BACKLOG":
        updatedTask = yield* tasks.moveToBacklog(taskId, changedBy);
        break;
      case "READY":
        updatedTask = yield* tasks.moveToReady(taskId, changedBy);
        break;
      case "IN_PROGRESS":
        updatedTask = yield* tasks.start(taskId, changedBy);
        break;
      case "PR_REVIEW":
        updatedTask = yield* tasks.submitForReview(taskId, { changedBy });
        break;
      case "COMPLETED":
        updatedTask = yield* tasks.complete(taskId, { changedBy });
        break;
      case "ABANDONED":
        updatedTask = yield* tasks.abandon(taskId, "Abandoned via transition", changedBy);
        break;
      default:
        return yield* Effect.fail(
          new BusinessRuleError(`Unsupported status transition to ${toStatus as string}`)
        );
    }

    return { task: updatedTask, previousStatus };
  });
}

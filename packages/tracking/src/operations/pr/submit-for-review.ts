/**
 * submitForReview - Submit a task for review
 *
 * Validates task state and transitions the task to PR_REVIEW status via
 * TaskDomainService.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { validateInput } from "../validation.js";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const SubmitForReviewSchema = z.object({
  taskId: z.string().min(1),
  force: z.boolean().optional().default(false),
});

export type SubmitForReviewInput = z.infer<typeof SubmitForReviewSchema>;

export interface SubmitForReviewResult {
  success: boolean;
  forced: boolean;
  task: {
    id: string;
    status: string;
  };
  pr: {
    number: number;
    url: string | undefined;
  } | null;
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Submit a task for review.
 *
 * 1. Validate input and resolve services
 * 2. Find task by ID
 * 3. Validate task is IN_PROGRESS (or force)
 * 4. Validate task has a PR (or force)
 * 5. Update status via TaskDomainService
 * 6. Return updated status and PR info
 */
export function submitForReview(input: SubmitForReviewInput) {
  return Effect.gen(function* () {
    const { taskId, force } = validateInput(SubmitForReviewSchema, input);
    const taskDomainService = yield* TaskDomainService;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    if (task.status !== "IN_PROGRESS" && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task must be IN_PROGRESS to submit for review. Current status: ${task.status}. ` +
            "Use force=true to bypass this check if the task state has drifted."
        )
      );
    }

    if (!task.prNumber && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          "Task does not have a PR. Use create_pr first to create a PR, " +
            "or use force=true to bypass this check."
        )
      );
    }

    yield* taskDomainService.submitForReview(taskId, { force });

    return {
      success: true,
      forced: force,
      task: {
        id: taskId,
        status: "PR_REVIEW",
      },
      pr: task.prNumber
        ? {
            number: task.prNumber,
            url: task.prUrl,
          }
        : null,
      message: task.prNumber
        ? `Task transitioned to PR_REVIEW. PR #${task.prNumber}: ${task.prUrl}`
        : "Task transitioned to PR_REVIEW (no PR linked).",
    } satisfies SubmitForReviewResult;
  });
}

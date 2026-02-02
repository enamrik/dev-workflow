/**
 * pauseIssue - Pause work on an issue by moving READY tasks to BACKLOG
 *
 * Delegates to PlanningService to move all READY tasks back to BACKLOG,
 * allowing temporary deactivation of an issue's work.
 */

import { z } from "zod";
import { PlanningService } from "../../domain/plans/planning-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const PauseIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type PauseIssueInput = z.infer<typeof PauseIssueSchema>;

export interface PauseIssueResult {
  message: string;
  tasksMovedCount: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Pause work on an issue.
 *
 * 1. Validate input schema
 * 2. Delegate to PlanningService.pauseIssue
 * 3. Format and return result
 */
export function pauseIssue(input: PauseIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(PauseIssueSchema, input);
    const planningService = yield* PlanningService;

    const result = yield* Effect.promise(() => planningService.pauseIssue(issueNumber));

    return {
      message:
        result.count > 0
          ? `Paused issue #${issueNumber}: ${result.count} task(s) moved from READY to BACKLOG`
          : `Issue #${issueNumber} has no READY tasks to pause`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    } satisfies PauseIssueResult;
  });
}

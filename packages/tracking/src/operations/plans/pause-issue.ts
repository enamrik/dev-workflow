/**
 * pauseIssue - Pause work on an issue by moving READY tasks to BACKLOG
 *
 * Delegates to PlanDomainService to move all READY tasks back to BACKLOG,
 * allowing temporary deactivation of an issue's work.
 * Side effects (events) are owned by this operation.
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { EventBus } from "../../events/event-bus.js";
import { EntityNotFoundError } from "../../domain/errors.js";
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
 * 2. Resolve issue for event payload
 * 3. Delegate to PlanDomainService.pauseIssue
 * 4. Emit issue:paused event
 * 5. Format and return result
 */
export function pauseIssue(input: PauseIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(PauseIssueSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const eventBus = yield* EventBus;

    const issue = yield* issueDomainService.findByNumber(issueNumber);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", `#${issueNumber}`));
    }

    const result = yield* planDomainService.pauseIssue(issueNumber);

    // Side effect: emit event for real-time UI updates
    if (result.count > 0) {
      eventBus.emit("issue:paused", {
        issueId: issue.id,
        issueNumber,
        tasksMovedCount: result.count,
      });
    }

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

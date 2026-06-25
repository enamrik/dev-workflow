/**
 * moveIssueToReady - Move BACKLOG tasks to READY
 *
 * Delegates domain transitions to PlanDomainService.readyIssue().
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

export const MoveIssueToReadySchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type MoveIssueToReadyInput = z.infer<typeof MoveIssueToReadySchema>;

export interface MoveIssueToReadyResult {
  message: string;
  tasksMovedCount: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Move an issue's tasks from BACKLOG to READY.
 */
export function moveIssueToReady(input: MoveIssueToReadyInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(MoveIssueToReadySchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const eventBus = yield* EventBus;

    const issue = yield* issueDomainService.findByNumber(issueNumber);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", `#${issueNumber}`));
    }

    const result = yield* planDomainService.readyIssue(issueNumber);

    if (result.count > 0) {
      eventBus.emit("issue:readied", {
        issueId: issue.id,
        issueNumber,
        tasksMovedCount: result.count,
      });
    }

    return {
      message:
        result.count > 0
          ? `Issue #${issueNumber} is ready: ${result.count} task(s) moved from BACKLOG to READY`
          : `Issue #${issueNumber} has no BACKLOG tasks to ready`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    } satisfies MoveIssueToReadyResult;
  });
}

/**
 * moveIssueToReady - Move BACKLOG tasks to READY and sync status to external provider
 *
 * Marks an issue as "next up" by transitioning all BACKLOG tasks to READY,
 * then syncs each task's READY status to the external provider.
 * Side effects (sync, events) are owned by this operation.
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { EventBus } from "../../events/event-bus.js";
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
 *
 * 1. Validate input
 * 2. Resolve issue for event payload
 * 3. Call planDomainService.readyIssue to transition BACKLOG → READY
 * 4. Sync each task's READY status to external provider
 * 5. Emit issue:readied event
 * 6. Return summary
 */
export function moveIssueToReady(input: MoveIssueToReadyInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(MoveIssueToReadySchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const taskService = yield* TaskService;

    // Resolve issue for event payload (need issueId)
    const issue = yield* issueDomainService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    const result = yield* planDomainService.readyIssue(issueNumber);

    // Side effect: sync each task's READY status to external provider
    for (const task of result.tasks) {
      yield* taskService.syncTaskStatus(task.id, "READY");
    }

    // Side effect: emit event for real-time UI updates
    if (result.count > 0) {
      EventBus.getInstance().emit("issue:readied", {
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

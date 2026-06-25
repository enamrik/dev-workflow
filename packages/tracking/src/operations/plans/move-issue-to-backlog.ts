/**
 * moveIssueToBacklog - Activate a PLANNED issue by moving tasks to BACKLOG
 *
 * Delegates domain transitions to PlanDomainService.activateIssue().
 */

import { z } from "zod";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const MoveIssueToBacklogSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type MoveIssueToBacklogInput = z.infer<typeof MoveIssueToBacklogSchema>;

export interface MoveIssueToBacklogResult {
  message: string;
  issueNumber: number;
  issueStatus: string;
  issueTransitioned?: boolean;
  tasksActivated: number;
  tasks: Array<{
    taskId: string;
    taskNumber: number;
  }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG.
 */
export function moveIssueToBacklog(input: MoveIssueToBacklogInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(MoveIssueToBacklogSchema, input);
    const planDomainService = yield* PlanDomainService;

    const activation = yield* planDomainService.activateIssue(issueNumber);
    const count = activation.activatedTasks.length;

    return {
      message:
        count > 0
          ? `Issue #${issueNumber} activated. ${count} task(s) moved to BACKLOG.`
          : `Issue #${issueNumber} is already active with no PLANNED tasks`,
      issueNumber: activation.issue.number,
      issueStatus: activation.issue.status,
      issueTransitioned: activation.issueTransitioned,
      tasksActivated: count,
      tasks: activation.activatedTasks.map((t) => ({
        taskId: t.id,
        taskNumber: t.number,
      })),
    } satisfies MoveIssueToBacklogResult;
  });
}

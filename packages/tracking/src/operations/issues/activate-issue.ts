/**
 * activateIssue - Transition a PLANNED issue to OPEN and its tasks to BACKLOG
 *
 * Validates the issue is in PLANNED status and has a plan, then
 * atomically transitions all PLANNED tasks to BACKLOG and the issue to OPEN.
 */

import { z } from "zod";
import type { Issue, IssueStatus } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ActivateIssueSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
});
export type ActivateIssueInput = z.infer<typeof ActivateIssueSchema>;

export interface ActivateIssueResult {
  issue: Issue;
  previousStatus: string;
  tasksActivated: number;
  tasks: Array<{ id: string; number: number; title: string }>;
}

// =============================================================================
// Operation
// =============================================================================

export function activateIssue(input: ActivateIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber } = validateInput(ActivateIssueSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    const issue = yield* pd.issues.getByNumber(issueNumber);
    if (!issue.isInPlanning) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Issue must be in PLANNED status to activate. Current status: ${issue.status}`
        )
      );
    }

    const plan = yield* pd.plans.findByIssueId(issue.id);
    if (!plan) {
      return yield* Effect.fail(
        new BusinessRuleError("No plan found for this issue. Generate a plan first.")
      );
    }

    const allTasks = yield* pd.tasks.findByPlanId(plan.id);
    const previousStatus = issue.status;

    const result = yield* pd.transaction(({ issues, tasks }) =>
      Effect.gen(function* () {
        const activated: Array<{ id: string; number: number; title: string }> = [];

        for (const task of allTasks) {
          if (task.status === "PLANNED") {
            yield* tasks.moveToBacklog(task.id, "system");
            activated.push({ id: task.id, number: task.number, title: task.title });
          }
        }

        const updatedIssue = yield* issues.updateStatus(issue.id, "OPEN" as IssueStatus);

        return { issue: updatedIssue, tasksActivated: activated.length, tasks: activated };
      })
    );

    return { ...result, previousStatus };
  });
}

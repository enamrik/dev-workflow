/**
 * getIssueDetails - Get an issue with its plan and tasks
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import type { Plan } from "../../domain/plans/plan.js";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetIssueDetailsSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
  includePlan: z.boolean().optional().default(false),
});
export type GetIssueDetailsInput = z.infer<typeof GetIssueDetailsSchema>;

export type GetIssueDetailsResult = {
  issue: Issue;
  plan?: Plan | null;
  tasks?: Task[];
};

// =============================================================================
// Operation
// =============================================================================

/**
 * Get an issue with its plan and tasks.
 *
 * 1. Validate input and resolve project domain
 * 2. Fetch issue by number
 * 3. Fetch associated plan (if any) and its tasks
 */
export function getIssueDetails(input: GetIssueDetailsInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber, includePlan } = validateInput(GetIssueDetailsSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    const issue = yield* pd.issues.getByNumber(issueNumber);

    if (!includePlan) {
      return { issue };
    }

    const plan = yield* pd.plans.findByIssueId(issue.id);
    const tasks = plan ? yield* pd.tasks.findByPlanId(plan.id) : [];

    return { issue, plan, tasks };
  });
}

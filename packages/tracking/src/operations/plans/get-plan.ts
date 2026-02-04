/**
 * getPlan - Get the active plan for an issue with its tasks
 *
 * Resolves an issue by ID or number, fetches its plan, and returns
 * the plan with all associated tasks.
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { EntityNotFoundError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetPlanSchema = z.object({
  issueId: z.string().optional(),
  issueNumber: z.number().int().positive().optional(),
});
export type GetPlanInput = z.infer<typeof GetPlanSchema>;

export interface GetPlanResult {
  plan: unknown;
  tasks: unknown[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get the active plan for an issue.
 *
 * 1. Validate input schema
 * 2. Resolve issue via specification pattern
 * 3. Fetch plan by issue ID
 * 4. Fetch tasks by plan ID
 */
export function getPlan(input: GetPlanInput) {
  return Effect.gen(function* () {
    const { issueId, issueNumber } = validateInput(GetPlanSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const taskDomainService = yield* TaskDomainService;

    const issue = yield* issueDomainService.getOne({ byId: issueId, byNumber: issueNumber });

    const plan = yield* planDomainService.findByIssueId(issue.id);
    if (!plan) {
      return yield* Effect.fail(new EntityNotFoundError("Plan", `for issue ${issue.id}`));
    }

    const tasks = yield* taskDomainService.findByPlanId(plan.id);

    return { plan, tasks } satisfies GetPlanResult;
  });
}

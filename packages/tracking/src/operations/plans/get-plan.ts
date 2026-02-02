/**
 * getPlan - Get the active plan for an issue with its tasks
 *
 * Resolves an issue by ID or number, fetches its plan, and returns
 * the plan with all associated tasks.
 */

import { z } from "zod";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
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
 * 2. Resolve issue from issueId or issueNumber
 * 3. Fetch plan by issue ID
 * 4. Fetch tasks by plan ID
 */
export function getPlan(input: GetPlanInput) {
  return Effect.gen(function* () {
    const { issueId, issueNumber } = validateInput(GetPlanSchema, input);
    const issueService = yield* IssueService;
    const planService = yield* PlanService;
    const taskService = yield* TaskService;

    // 1. Resolve issue ID
    let resolvedIssueId = issueId;
    if (!resolvedIssueId && issueNumber) {
      const issue = yield* issueService.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }
      resolvedIssueId = issue.id;
    }

    if (!resolvedIssueId) {
      throw new Error("Either issueId or issueNumber is required");
    }

    // 2. Fetch plan
    const plan = yield* Effect.promise(() => planService.findByIssueId(resolvedIssueId));
    if (!plan) {
      throw new Error("No plan found for this issue");
    }

    // 3. Fetch tasks
    const tasks = yield* Effect.promise(() => taskService.findByPlanId(plan.id));

    return { plan, tasks } satisfies GetPlanResult;
  });
}

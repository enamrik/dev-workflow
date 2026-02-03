/**
 * assignIssueToMilestone - Assign an issue to a milestone
 *
 * Looks up both the issue and milestone by number, then assigns
 * the issue to the milestone via MilestoneDomainService.
 */

import { z } from "zod";
import { MilestoneDomainService } from "../../domain/milestones/milestone-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const AssignIssueToMilestoneSchema = z.object({
  issueNumber: z.number().int().positive(),
  milestoneNumber: z.number().int().positive(),
});
export type AssignIssueToMilestoneInput = z.infer<typeof AssignIssueToMilestoneSchema>;

export interface AssignIssueToMilestoneResult {
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Assign an issue to a milestone.
 *
 * 1. Validate input
 * 2. Look up issue and milestone by number
 * 3. Assign the issue to the milestone
 */
export function assignIssueToMilestone(input: AssignIssueToMilestoneInput) {
  return Effect.gen(function* () {
    const { issueNumber, milestoneNumber } = validateInput(AssignIssueToMilestoneSchema, input);
    const milestoneDomainService = yield* MilestoneDomainService;
    const issueDomainService = yield* IssueDomainService;

    const issue = yield* issueDomainService.getIssueByNumber(issueNumber);
    const milestone = yield* milestoneDomainService.getMilestoneByNumber(milestoneNumber);

    yield* milestoneDomainService.assignIssue(issue.id, milestone.id);

    return {
      message: `Assigned issue #${issue.number} to milestone M${milestone.number}: ${milestone.title}`,
    };
  });
}

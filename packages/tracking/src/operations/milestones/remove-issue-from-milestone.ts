/**
 * removeIssueFromMilestone - Remove an issue from its milestone
 *
 * Looks up the issue by number, verifies it has a milestone assigned,
 * then unassigns it via MilestoneService.
 */

import { z } from "zod";
import { MilestoneService } from "../../domain/milestones/milestone-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RemoveIssueFromMilestoneSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type RemoveIssueFromMilestoneInput = z.infer<typeof RemoveIssueFromMilestoneSchema>;

export interface RemoveIssueFromMilestoneResult {
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Remove an issue from its milestone.
 *
 * 1. Validate input
 * 2. Look up issue by number
 * 3. Verify issue has a milestone assigned
 * 4. Unassign the issue from its milestone
 */
export function removeIssueFromMilestone(input: RemoveIssueFromMilestoneInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(RemoveIssueFromMilestoneSchema, input);
    const milestoneService = yield* MilestoneService;
    const issueService = yield* IssueService;

    const issue = yield* issueService.getIssueByNumber(issueNumber);

    if (!issue.milestoneId) {
      throw new Error(`Issue #${issue.number} is not assigned to any milestone`);
    }

    yield* milestoneService.unassignIssue(issue.id);

    return {
      message: `Removed issue #${issue.number} from its milestone`,
    };
  });
}

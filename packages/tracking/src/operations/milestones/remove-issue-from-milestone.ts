/**
 * removeIssueFromMilestone - Remove an issue from its milestone
 *
 * Looks up the issue by number, verifies it has a milestone assigned,
 * then unassigns it via MilestoneDomainService.
 */

import { z } from "zod";
import { MilestoneDomainService } from "../../domain/milestones/milestone-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { BusinessRuleError } from "../../domain/errors.js";

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
    const milestoneDomainService = yield* MilestoneDomainService;
    const issueDomainService = yield* IssueDomainService;

    const issue = yield* issueDomainService.getIssueByNumber(issueNumber);

    if (!issue.milestoneId) {
      return yield* Effect.fail(
        new BusinessRuleError(`Issue #${issue.number} is not assigned to any milestone`)
      );
    }

    yield* milestoneDomainService.unassignIssue(issue.id);

    return {
      message: `Removed issue #${issue.number} from its milestone`,
    };
  });
}

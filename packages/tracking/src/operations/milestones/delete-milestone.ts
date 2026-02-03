/**
 * deleteMilestone - Delete a milestone and unassign its issues
 *
 * Finds the milestone by number, unassigns all associated issues,
 * then deletes the milestone.
 */

import { z } from "zod";
import { MilestoneDomainService } from "../../domain/milestones/milestone-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const DeleteMilestoneSchema = z.object({
  milestoneNumber: z.number().int().positive(),
});
export type DeleteMilestoneInput = z.infer<typeof DeleteMilestoneSchema>;

export interface DeleteMilestoneResult {
  message: string;
  unassignedIssues: number;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Delete a milestone.
 *
 * 1. Validate input
 * 2. Find milestone by number
 * 3. Unassign all issues from the milestone
 * 4. Delete the milestone
 */
export function deleteMilestone(input: DeleteMilestoneInput) {
  return Effect.gen(function* () {
    const { milestoneNumber } = validateInput(DeleteMilestoneSchema, input);
    const milestoneDomainService = yield* MilestoneDomainService;
    const issueDomainService = yield* IssueDomainService;

    const milestone = yield* milestoneDomainService.getMilestoneByNumber(milestoneNumber);

    // Unassign all issues from this milestone
    const issues = yield* issueDomainService.findMany({ milestoneId: milestone.id });

    for (const issue of issues) {
      yield* milestoneDomainService.unassignIssue(issue.id);
    }

    // Delete the milestone
    yield* milestoneDomainService.delete(milestone.id);

    return {
      message: `Deleted milestone M${milestone.number}: ${milestone.title}. Unassigned ${issues.length} issue(s).`,
      unassignedIssues: issues.length,
    };
  });
}

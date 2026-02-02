/**
 * deleteMilestone - Delete a milestone and unassign its issues
 *
 * Finds the milestone by number, unassigns all associated issues,
 * then deletes the milestone.
 */

import { z } from "zod";
import { MilestoneService } from "../../domain/milestones/milestone-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
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
    const milestoneService = yield* MilestoneService;
    const issueService = yield* IssueService;

    const milestone = yield* milestoneService.getMilestoneByNumber(milestoneNumber);

    // Unassign all issues from this milestone
    const issues = yield* issueService.findMany({ milestoneId: milestone.id });

    for (const issue of issues) {
      yield* milestoneService.unassignIssue(issue.id);
    }

    // Delete the milestone
    yield* milestoneService.delete(milestone.id);

    return {
      message: `Deleted milestone M${milestone.number}: ${milestone.title}. Unassigned ${issues.length} issue(s).`,
      unassignedIssues: issues.length,
    };
  });
}

/**
 * getMilestone - Get a milestone with computed status and issue summary
 *
 * Looks up by id or milestoneNumber, enriches with computed status
 * and issue breakdown (open, in-progress, closed counts).
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import type { MilestoneWithStatus } from "../../domain/milestones/milestone-domain-service.js";
import { MilestoneDomainService } from "../../domain/milestones/milestone-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { ValidationError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetMilestoneSchema = z.object({
  id: z.string().optional(),
  milestoneNumber: z.number().int().positive().optional(),
});
export type GetMilestoneInput = z.infer<typeof GetMilestoneSchema>;

export interface MilestoneIssueSummary {
  totalIssues: number;
  openIssues: number;
  inProgressIssues: number;
  closedIssues: number;
}

/**
 * An issue belonging to a (global) milestone, tagged with its owning project.
 * Milestones span projects, so each issue carries its own project context.
 */
export interface GetMilestoneIssue {
  issue: Issue;
  projectId: string;
  projectSlug: string;
  projectName: string;
}

export interface GetMilestoneResult {
  milestone: MilestoneWithStatus;
  issues: GetMilestoneIssue[];
  summary: MilestoneIssueSummary;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get a milestone with its issues and summary.
 *
 * 1. Validate input (at least one of id or milestoneNumber required)
 * 2. Resolve milestone by id or number
 * 3. Fetch associated issues and compute summary
 */
export function getMilestone(input: GetMilestoneInput) {
  return Effect.gen(function* () {
    const { id, milestoneNumber } = validateInput(GetMilestoneSchema, input);
    const milestoneDomainService = yield* MilestoneDomainService;

    if (!id && milestoneNumber == null) {
      return yield* Effect.fail(
        new ValidationError("id", "Either id or milestoneNumber is required")
      );
    }

    let milestone: MilestoneWithStatus;
    if (id) {
      milestone = yield* milestoneDomainService.getMilestone(id);
    } else {
      milestone = yield* milestoneDomainService.getMilestoneByNumber(milestoneNumber!);
    }

    // Milestones are global: pull member issues across all projects, each
    // tagged with its owning project.
    const members = yield* milestoneDomainService.findMilestoneIssues(milestone.id);
    const issues: GetMilestoneIssue[] = members.map((m) => ({
      issue: m.issue,
      projectId: m.projectId,
      projectSlug: m.projectSlug,
      projectName: m.projectName,
    }));

    const closedIssues = issues.filter((i) => i.issue.isClosed).length;
    const plannedIssues = issues.filter((i) => i.issue.isInPlanning).length;
    const openIssues = issues.length - closedIssues - plannedIssues;

    // openIssues here captures OPEN + IN_PROGRESS; split further for summary
    const inProgressIssues = issues.filter(
      (i) => !i.issue.isClosed && !i.issue.isInPlanning && i.issue.status === "IN_PROGRESS"
    ).length;
    const pureOpenIssues = openIssues - inProgressIssues;

    const summary: MilestoneIssueSummary = {
      totalIssues: issues.length,
      openIssues: pureOpenIssues,
      inProgressIssues,
      closedIssues,
    };

    return { milestone, issues, summary };
  });
}

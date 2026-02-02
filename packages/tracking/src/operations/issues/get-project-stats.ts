/**
 * getProjectStats - Get issue and task counts by status
 *
 * Returns aggregate counts of issues and tasks grouped by status,
 * useful for dashboard displays and project health monitoring.
 */

import { z } from "zod";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetProjectStatsSchema = z.object({
  projectSlug: z.string().min(1),
});
export type GetProjectStatsInput = z.infer<typeof GetProjectStatsSchema>;

export interface GetProjectStatsResult {
  issues: {
    planned: number;
    open: number;
    inProgress: number;
    closed: number;
    total: number;
  };
  tasks: {
    planned: number;
    backlog: number;
    ready: number;
    inProgress: number;
    prReview: number;
    completed: number;
    abandoned: number;
    total: number;
  };
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get project statistics: issue and task counts by status.
 *
 * 1. Validate input and resolve project domain
 * 2. Fetch status counts for issues and tasks
 * 3. Calculate totals and return structured result
 */
export function getProjectStats(input: GetProjectStatsInput) {
  return Effect.gen(function* () {
    const { projectSlug } = validateInput(GetProjectStatsSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    const issueCounts = yield* pd.issues.getStatusCounts();
    const taskCounts = yield* pd.tasks.getStatusCounts();

    const issueTotal = Object.values(issueCounts).reduce((a, b) => a + b, 0);
    const taskTotal = Object.values(taskCounts).reduce((a, b) => a + b, 0);

    return {
      issues: {
        planned: issueCounts["PLANNED"] ?? 0,
        open: issueCounts["OPEN"] ?? 0,
        inProgress: issueCounts["IN_PROGRESS"] ?? 0,
        closed: issueCounts["CLOSED"] ?? 0,
        total: issueTotal,
      },
      tasks: {
        planned: taskCounts["PLANNED"] ?? 0,
        backlog: taskCounts["BACKLOG"] ?? 0,
        ready: taskCounts["READY"] ?? 0,
        inProgress: taskCounts["IN_PROGRESS"] ?? 0,
        prReview: taskCounts["PR_REVIEW"] ?? 0,
        completed: taskCounts["COMPLETED"] ?? 0,
        abandoned: taskCounts["ABANDONED"] ?? 0,
        total: taskTotal,
      },
    } satisfies GetProjectStatsResult;
  });
}

/**
 * searchIssues - Search issues by keyword in title or description
 *
 * Returns slim results with computed status for each matching issue.
 * Case-insensitive search, limited to 10 results.
 */

import { z } from "zod";
import { Issue } from "../../domain/issues/issue.js";
import type {
  ComputedIssueStatus,
  IssueStatus,
  IssueType,
  IssuePriority,
} from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const SearchIssuesSchema = z.object({
  projectSlug: z.string().min(1),
  query: z.string().min(1, "Search query is required"),
});
export type SearchIssuesInput = z.infer<typeof SearchIssuesSchema>;

export interface SearchIssueResult {
  id: string;
  number: number;
  title: string;
  status: IssueStatus;
  type: IssueType;
  priority: IssuePriority;
  computedStatus: ComputedIssueStatus;
}

export interface SearchIssuesResult {
  results: SearchIssueResult[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Search issues by keyword.
 *
 * 1. Validate input and resolve project domain
 * 2. Search issues via repository (case-insensitive, max 10)
 * 3. Compute status for each result by loading plan and tasks
 * 4. Return slim results with computed status
 */
export function searchIssues(input: SearchIssuesInput) {
  return Effect.gen(function* () {
    const { projectSlug, query } = validateInput(SearchIssuesSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    const results = yield* pd.issues.search(query);

    // Add computedStatus to each result by loading plan/tasks
    const resultsWithComputedStatus: SearchIssueResult[] = [];

    for (const result of results) {
      const plan = yield* pd.plans.findByIssueId(result.id);
      const tasks = plan ? yield* pd.tasks.findByPlanId(plan.id) : [];

      // computeIssueStatus expects a full Issue, but we only have slim data.
      // Build a minimal issue-like object for the computation.
      const computedStatus = Issue.computeStatus({ status: result.status } as Issue, tasks);

      resultsWithComputedStatus.push({
        id: result.id,
        number: result.number,
        title: result.title,
        status: result.status,
        type: result.type,
        priority: result.priority,
        computedStatus,
      });
    }

    return { results: resultsWithComputedStatus } satisfies SearchIssuesResult;
  });
}

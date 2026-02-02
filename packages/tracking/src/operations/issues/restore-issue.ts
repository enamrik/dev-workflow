/**
 * restoreIssue - Restore a soft-deleted issue
 *
 * Finds a deleted issue by number and restores it.
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError, EntityNotFoundError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RestoreIssueSchema = z
  .object({
    projectSlug: z.string().min(1),
    issueId: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
  })
  .refine((data) => data.issueId || data.issueNumber, {
    message: "Either issueId or issueNumber is required",
  });
export type RestoreIssueInput = z.infer<typeof RestoreIssueSchema>;

export interface RestoreIssueResult {
  issue: Issue;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Restore a soft-deleted issue.
 *
 * 1. Validate input and resolve project domain
 * 2. Find the deleted issue (search includes deleted issues)
 * 3. Verify it is actually deleted
 * 4. Restore it
 */
export function restoreIssue(input: RestoreIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueId, issueNumber } = validateInput(RestoreIssueSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    // Find the issue including deleted ones
    const allIssues = yield* pd.issues.findMany({ includeDeleted: true });
    const issue = issueId
      ? allIssues.find((i) => i.id === issueId)
      : issueNumber !== undefined
        ? allIssues.find((i) => i.number === issueNumber)
        : null;

    if (!issue) {
      const identifier = issueId ?? `#${issueNumber}`;
      return yield* Effect.fail(new EntityNotFoundError("Issue", identifier));
    }

    if (!issue.isDeleted) {
      return yield* Effect.fail(new BusinessRuleError(`Issue #${issue.number} is not deleted`));
    }

    const restored = yield* pd.issues.restore(issue.id);

    return { issue: restored } satisfies RestoreIssueResult;
  });
}

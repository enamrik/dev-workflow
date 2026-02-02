/**
 * getSnapshotHistory - Get version history for an issue
 *
 * Returns all snapshots for an issue. Accepts either issueId or issueNumber.
 */

import { z } from "zod";
import { IssueService } from "../../domain/issues/issue-service.js";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetSnapshotHistorySchema = z.object({
  issueId: z.string().optional(),
  issueNumber: z.number().optional(),
});
export type GetSnapshotHistoryInput = z.infer<typeof GetSnapshotHistorySchema>;

// =============================================================================
// Operation
// =============================================================================

export function getSnapshotHistory(input: GetSnapshotHistoryInput) {
  return Effect.gen(function* () {
    const { issueId, issueNumber } = validateInput(GetSnapshotHistorySchema, input);
    const issueService = yield* IssueService;
    const versioningService = yield* VersioningService;

    let resolvedIssueNumber = issueNumber;
    if (!resolvedIssueNumber && issueId) {
      const issue = yield* issueService.findById(issueId);
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`);
      }
      resolvedIssueNumber = issue.number;
    }

    if (!resolvedIssueNumber) {
      throw new Error("Either issueId or issueNumber is required");
    }

    return yield* versioningService.getSnapshotHistory(resolvedIssueNumber);
  });
}

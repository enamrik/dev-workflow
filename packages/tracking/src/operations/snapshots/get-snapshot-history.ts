/**
 * getSnapshotHistory - Get version history for an issue
 *
 * Returns all snapshots for an issue. Accepts either issueId or issueNumber.
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
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
    const issueDomainService = yield* IssueDomainService;
    const versioningService = yield* VersioningService;

    // Resolve issue to get its number
    const issue = yield* issueDomainService.getOne({ byId: issueId, byNumber: issueNumber });

    return yield* versioningService.getSnapshotHistory(issue.number);
  });
}

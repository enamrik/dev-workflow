/**
 * revertToSnapshot - Revert issue to a previous version
 *
 * Creates a new snapshot based on old data. The current state becomes
 * the next version with the reverted content.
 */

import { z } from "zod";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RevertToSnapshotSchema = z.object({
  issueNumber: z.number(),
  version: z.number(),
  notes: z.string().optional(),
});
export type RevertToSnapshotInput = z.infer<typeof RevertToSnapshotSchema>;

// =============================================================================
// Operation
// =============================================================================

export function revertToSnapshot(input: RevertToSnapshotInput) {
  return Effect.gen(function* () {
    const { issueNumber, version, notes } = validateInput(RevertToSnapshotSchema, input);
    const versioningService = yield* VersioningService;

    return yield* Effect.promise(() =>
      versioningService.revertToSnapshot(issueNumber, version, "claude-agent", notes)
    );
  });
}

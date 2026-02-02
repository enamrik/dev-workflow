/**
 * viewSnapshot - View issue state at a specific version (time travel)
 *
 * Read-only view of the complete issue state at a given version number.
 */

import { z } from "zod";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ViewSnapshotSchema = z.object({
  issueNumber: z.number(),
  version: z.number(),
});
export type ViewSnapshotInput = z.infer<typeof ViewSnapshotSchema>;

// =============================================================================
// Operation
// =============================================================================

export function viewSnapshot(input: ViewSnapshotInput) {
  return Effect.gen(function* () {
    const { issueNumber, version } = validateInput(ViewSnapshotSchema, input);
    const versioningService = yield* VersioningService;

    return yield* Effect.promise(() => versioningService.viewSnapshot(issueNumber, version));
  });
}

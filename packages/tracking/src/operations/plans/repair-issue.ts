/**
 * repairIssue - Repair external sync state for all tasks in an issue
 *
 * Delegates all repair logic to ProjectManagementService.repairIssueSyncState().
 */

import { z } from "zod";
import type { RepairSyncResult } from "../../project-sync/project-management-service.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RepairIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type RepairIssueInput = z.infer<typeof RepairIssueSchema>;

export type RepairIssueResult = RepairSyncResult;

// =============================================================================
// Operation
// =============================================================================

export function repairIssue(input: RepairIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(RepairIssueSchema, input);
    const pmService = yield* ProjectManagementService;

    return yield* pmService.repairIssueSyncState(issueNumber);
  });
}

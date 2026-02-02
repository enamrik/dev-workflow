/**
 * listMilestones - List all milestones with computed status and issue counts
 *
 * Fetches all milestones, enriches each with computed status and issue
 * counts, and optionally filters by computed status.
 */

import { z } from "zod";
import type { MilestoneWithStatus } from "../../domain/milestones/milestone-service.js";
import { MilestoneService } from "../../domain/milestones/milestone-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ListMilestonesSchema = z.object({
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).optional(),
});
export type ListMilestonesInput = z.infer<typeof ListMilestonesSchema>;

export interface ListMilestonesResult {
  milestones: MilestoneWithStatus[];
  count: number;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * List all milestones with computed status.
 *
 * 1. Validate input
 * 2. Fetch milestones with computed status (filters by status if provided)
 */
export function listMilestones(input: ListMilestonesInput) {
  return Effect.gen(function* () {
    const { status } = validateInput(ListMilestonesSchema, input);
    const milestoneService = yield* MilestoneService;

    const milestones = yield* milestoneService.listMilestones(status);

    return { milestones, count: milestones.length };
  });
}

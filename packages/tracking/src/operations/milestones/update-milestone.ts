/**
 * updateMilestone - Update milestone properties with validation
 *
 * Validates that status can only be set to "COMPLETED", validates date
 * formats and range, then delegates to MilestoneService.
 */

import { z } from "zod";
import type { MilestoneWithStatus } from "../../domain/milestones/milestone-service.js";
import { MilestoneService } from "../../domain/milestones/milestone-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const UpdateMilestoneSchema = z.object({
  milestoneNumber: z.number().int().positive(),
  updates: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).optional(),
  }),
});
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneSchema>;

export interface UpdateMilestoneResult {
  message: string;
  milestone: MilestoneWithStatus;
}

// =============================================================================
// Helpers
// =============================================================================

function validateDateFormat(date: string, fieldName: string): void {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
  }
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Update a milestone.
 *
 * 1. Validate input schema
 * 2. Validate status (only COMPLETED allowed)
 * 3. Validate date formats and range
 * 4. Update via MilestoneService and return with computed status
 */
export function updateMilestone(input: UpdateMilestoneInput) {
  return Effect.gen(function* () {
    const { milestoneNumber, updates } = validateInput(UpdateMilestoneSchema, input);
    const milestoneService = yield* MilestoneService;

    // Validate status constraint
    if (updates.status && updates.status !== "COMPLETED") {
      throw new Error(
        `Cannot set status to ${updates.status}. Only COMPLETED can be set manually.`
      );
    }

    // Validate date formats
    if (updates.startDate) {
      validateDateFormat(updates.startDate, "startDate");
    }
    if (updates.endDate) {
      validateDateFormat(updates.endDate, "endDate");
    }

    // Look up milestone to validate date range
    const existing = yield* milestoneService.getMilestoneByNumber(milestoneNumber);

    const newStartDate = updates.startDate ?? existing.startDate;
    const newEndDate = updates.endDate ?? existing.endDate;
    if (newStartDate > newEndDate) {
      throw new Error("startDate must be before or equal to endDate");
    }

    // Update and get computed status
    yield* milestoneService.update(existing.id, updates);
    const milestone = yield* milestoneService.getMilestone(existing.id);

    return {
      message: `Updated milestone M${milestone.number}: ${milestone.title}`,
      milestone,
    };
  });
}

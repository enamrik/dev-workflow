/**
 * createMilestone - Create a new milestone with date validation
 *
 * Validates date format (YYYY-MM-DD) and date range (startDate <= endDate),
 * then delegates to MilestoneDomainService for creation.
 */

import { z } from "zod";
import { Milestone } from "../../domain/milestones/milestone.js";
import type { MilestoneWithStatus } from "../../domain/milestones/milestone-domain-service.js";
import { MilestoneDomainService } from "../../domain/milestones/milestone-domain-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { ValidationError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreateMilestoneSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneSchema>;

export interface CreateMilestoneResult {
  message: string;
  milestone: MilestoneWithStatus;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Create a new milestone.
 *
 * 1. Validate input schema
 * 2. Validate date formats and range
 * 3. Create milestone via MilestoneDomainService
 */
export function createMilestone(input: CreateMilestoneInput) {
  return Effect.gen(function* () {
    const { title, description, startDate, endDate } = validateInput(CreateMilestoneSchema, input);
    const milestoneDomainService = yield* MilestoneDomainService;

    const startCheck = Milestone.validateDate(startDate, "startDate");
    if (!startCheck.valid)
      return yield* Effect.fail(new ValidationError("startDate", startCheck.reason!));
    const endCheck = Milestone.validateDate(endDate, "endDate");
    if (!endCheck.valid)
      return yield* Effect.fail(new ValidationError("endDate", endCheck.reason!));

    const rangeCheck = Milestone.validateDateRange(startDate, endDate);
    if (!rangeCheck.valid)
      return yield* Effect.fail(new ValidationError("dateRange", rangeCheck.reason!));

    const milestone = yield* milestoneDomainService.createMilestone({
      title,
      description,
      startDate,
      endDate,
    });

    return {
      message: `Created milestone M${milestone.number}: ${milestone.title}`,
      milestone,
    };
  });
}

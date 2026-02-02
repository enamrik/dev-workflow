/**
 * Milestone tool schemas and handlers
 *
 * Pattern:
 * - Schemas define the MCP input validation (colocated with handlers)
 * - Handlers are thin wrappers: validate + delegate + return success
 * - createMcpHandler wraps with error handling and schema validation
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import {
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
  deleteMilestone,
  assignIssueToMilestone,
  removeIssueFromMilestone,
} from "@dev-workflow/tracking";

// =============================================================================
// Schemas
// =============================================================================

export const CreateMilestoneSchema = z.object({
  title: z.string().describe("Milestone title"),
  description: z.string().optional().describe("Milestone description"),
  startDate: z.string().describe("Start date in YYYY-MM-DD format"),
  endDate: z.string().describe("End date in YYYY-MM-DD format"),
});

export const GetMilestoneSchema = z.object({
  id: z.string().optional().describe("Milestone UUID"),
  milestoneNumber: z.number().optional().describe("Milestone number (e.g., 1 for M1)"),
});

export const ListMilestonesSchema = z.object({
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"])
    .optional()
    .describe("Filter by computed status"),
});

export const UpdateMilestoneSchema = z.object({
  milestoneNumber: z.number().describe("Milestone number (e.g., 1 for M1)"),
  updates: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z
        .enum(["COMPLETED"])
        .optional()
        .describe(
          "Only COMPLETED can be set manually. Other statuses are computed from issue states."
        ),
    })
    .describe(
      "Fields to update. Status can only be set to COMPLETED (manual sign-off); other statuses are computed automatically."
    ),
});

export const DeleteMilestoneSchema = z.object({
  milestoneNumber: z.number().describe("Milestone number (e.g., 1 for M1)"),
});

export const AssignIssueToMilestoneSchema = z.object({
  issueNumber: z.number().describe("Issue number to assign"),
  milestoneNumber: z.number().describe("Milestone number to assign to"),
});

export const RemoveIssueFromMilestoneSchema = z.object({
  issueNumber: z.number().describe("Issue number to remove from milestone"),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleCreateMilestone = createMcpHandler({
  schema: CreateMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* createMilestone(args));
    }),
});

export const handleGetMilestone = createMcpHandler({
  schema: GetMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getMilestone(args));
    }),
});

export const handleListMilestones = createMcpHandler({
  schema: ListMilestonesSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* listMilestones(args));
    }),
});

export const handleUpdateMilestone = createMcpHandler({
  schema: UpdateMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* updateMilestone(args));
    }),
});

export const handleDeleteMilestone = createMcpHandler({
  schema: DeleteMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* deleteMilestone(args));
    }),
});

export const handleAssignIssueToMilestone = createMcpHandler({
  schema: AssignIssueToMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* assignIssueToMilestone(args));
    }),
});

export const handleRemoveIssueFromMilestone = createMcpHandler({
  schema: RemoveIssueFromMilestoneSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* removeIssueFromMilestone(args));
    }),
});

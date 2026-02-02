/**
 * Snapshot tool schemas and handlers
 *
 * Schemas define the MCP input validation (colocated with handlers).
 * Handlers call operations directly (no tool class intermediary).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { Effect } from "@dev-workflow/effect";
import { createMcpHandler } from "../di/bootstrap.js";
import { getSnapshotHistory, revertToSnapshot, viewSnapshot } from "@dev-workflow/tracking";

// =============================================================================
// Schemas
// =============================================================================

export const GetSnapshotHistorySchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const RevertToSnapshotSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  version: z.number().describe("Version number to revert to"),
  notes: z.string().optional().describe("Reason for reversion"),
});

export const ViewSnapshotSchema = z.object({
  issueNumber: z.number().describe("Issue number"),
  version: z.number().describe("Version number to view"),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleGetSnapshotHistory = createMcpHandler({
  schema: GetSnapshotHistorySchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getSnapshotHistory(args));
    }),
});

export const handleRevertToSnapshot = createMcpHandler({
  schema: RevertToSnapshotSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* revertToSnapshot(args));
    }),
});

export const handleViewSnapshot = createMcpHandler({
  schema: ViewSnapshotSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* viewSnapshot(args));
    }),
});

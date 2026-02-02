/**
 * Merge tool schemas and handlers
 *
 * Schemas define the MCP input validation (colocated with handlers).
 * Handlers call operations directly (no tool class intermediary).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { mergeIssues } from "@dev-workflow/tracking";

// =============================================================================
// Local Enums
// =============================================================================

const MergeIssuesModeEnum = z.enum(["create_new", "merge_into"]);

// =============================================================================
// Schemas
// =============================================================================

export const MergeIssuesSchema = z.object({
  sourceIssueNumber: z
    .number()
    .describe("Issue number of the source issue (the one being merged from)"),
  targetIssueNumber: z
    .number()
    .describe("Issue number of the target issue (in merge_into mode, source folds into this)"),
  mode: MergeIssuesModeEnum.describe(
    "'create_new': Create a new issue from both (originals unchanged). 'merge_into': Fold source into target (source is soft-deleted)."
  ),
  newTitle: z
    .string()
    .optional()
    .describe("Custom title for the merged issue (create_new mode only, optional)"),
  newDescription: z
    .string()
    .optional()
    .describe("Custom description for the merged issue (create_new mode only, optional)"),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleMergeIssues = createMcpHandler({
  schema: MergeIssuesSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* mergeIssues(args));
    }),
});

/**
 * Merge Tool Definitions
 *
 * MCP tool definitions and handler functions for issue merge operations.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import { MergeIssuesSchema } from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { MergeTool } from "./merge-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const mergeToolDefinitions: ToolDefinition[] = [
  {
    name: "merge_issues",
    description:
      "Merge two issues into one. Supports two modes: " +
      "'create_new' creates a fresh issue combining both sources (originals unchanged), " +
      "'merge_into' folds source into target (source is soft-deleted). " +
      "Tasks from both issues are copied/moved to the result. " +
      "Returns warnings for any in-progress or PR-review tasks.",
    inputSchema: {
      type: "object",
      properties: {
        sourceIssueNumber: {
          type: "number",
          description: "Issue number of the source issue (the one being merged from)",
        },
        targetIssueNumber: {
          type: "number",
          description:
            "Issue number of the target issue (in merge_into mode, source folds into this)",
        },
        mode: {
          type: "string",
          enum: ["create_new", "merge_into"],
          description:
            "'create_new': Create a new issue from both (originals unchanged). " +
            "'merge_into': Fold source into target (source is soft-deleted).",
        },
        newTitle: {
          type: "string",
          description: "Custom title for the merged issue (create_new mode only, optional)",
        },
        newDescription: {
          type: "string",
          description: "Custom description for the merged issue (create_new mode only, optional)",
        },
      },
      required: ["sourceIssueNumber", "targetIssueNumber", "mode"],
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle merge_issues tool call
 */
export const handleMergeIssues = createMcpHandler(
  async (args: unknown, { mergeTool }: { mergeTool: MergeTool }) => {
    const validated = validateSchema(MergeIssuesSchema, args);
    const result = await mergeTool.merge(validated);
    return successResponse(result);
  }
);

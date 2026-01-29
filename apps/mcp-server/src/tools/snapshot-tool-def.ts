/**
 * Snapshot Tool Definitions
 *
 * MCP tool definitions and handler functions for snapshot/versioning operations.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import { GetSnapshotHistorySchema, RevertToSnapshotSchema, ViewSnapshotSchema } from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { SnapshotTool } from "./snapshot-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const snapshotToolDefinitions: ToolDefinition[] = [
  {
    name: "get_snapshot_history",
    description: "Get version history for an issue showing all snapshots",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
      },
    },
  },
  {
    name: "revert_to_snapshot",
    description:
      "Revert issue to a previous version snapshot. Creates new snapshot based on old data.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        version: {
          type: "number",
          description: "Version number to revert to",
        },
        notes: {
          type: "string",
          description: "Reason for reversion",
        },
      },
      required: ["issueNumber", "version"],
    },
  },
  {
    name: "view_snapshot",
    description:
      "View the complete state of an issue at a specific version (time travel, read-only).",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number",
        },
        version: {
          type: "number",
          description: "Version number to view",
        },
      },
      required: ["issueNumber", "version"],
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle get_snapshot_history tool call
 */
export const handleGetSnapshotHistory = createMcpHandler(
  (args: unknown, { snapshotTool }: { snapshotTool: SnapshotTool }) => {
    const validated = validateSchema(GetSnapshotHistorySchema, args);
    const result = snapshotTool.getSnapshotHistory(validated);
    return successResponse(result);
  }
);

/**
 * Handle revert_to_snapshot tool call
 */
export const handleRevertToSnapshot = createMcpHandler(
  (args: unknown, { snapshotTool }: { snapshotTool: SnapshotTool }) => {
    const validated = validateSchema(RevertToSnapshotSchema, args);
    const result = snapshotTool.revertToSnapshot(validated);
    return successResponse(result);
  }
);

/**
 * Handle view_snapshot tool call
 */
export const handleViewSnapshot = createMcpHandler(
  (args: unknown, { snapshotTool }: { snapshotTool: SnapshotTool }) => {
    const validated = validateSchema(ViewSnapshotSchema, args);
    const result = snapshotTool.viewSnapshot(validated);
    return successResponse(result);
  }
);

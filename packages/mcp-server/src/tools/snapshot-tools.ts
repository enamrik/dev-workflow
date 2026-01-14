/**
 * Snapshot/versioning MCP tools
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import {
  GetSnapshotHistorySchema,
  RevertToSnapshotSchema,
  ViewSnapshotSchema,
  type GetSnapshotHistoryArgs,
  type RevertToSnapshotArgs,
  type ViewSnapshotArgs,
} from "./schemas.js";
import { createMcpHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";

/**
 * Tool definitions for snapshot operations
 */
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
// Handler Implementations
// =============================================================================

/**
 * Handle get_snapshot_history tool call
 */
function getSnapshotHistoryHandler(
  args: unknown,
  { issueService, versioningService }: Pick<McpCradle, "issueService" | "versioningService">
): ToolResponse {
  const validation = validateToolArgs<GetSnapshotHistoryArgs>(GetSnapshotHistorySchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber } = validation.data;

  // Resolve issue number from ID if needed
  let resolvedIssueNumber = issueNumber;
  if (!resolvedIssueNumber && issueId) {
    const issue = issueService.findById(issueId);
    if (!issue) {
      return errorResponse(`Issue not found: ${issueId}`);
    }
    resolvedIssueNumber = issue.number;
  }

  if (!resolvedIssueNumber) {
    return errorResponse("Either issueId or issueNumber is required");
  }

  const history = versioningService.getSnapshotHistory(resolvedIssueNumber);

  return successResponse(history);
}

/**
 * Handle revert_to_snapshot tool call
 */
function revertToSnapshotHandler(
  args: unknown,
  { versioningService }: Pick<McpCradle, "versioningService">
): ToolResponse {
  const validation = validateToolArgs<RevertToSnapshotArgs>(RevertToSnapshotSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber, version, notes } = validation.data;

  const result = versioningService.revertToSnapshot(issueNumber, version, "claude-agent", notes);

  return successResponse(result);
}

/**
 * Handle view_snapshot tool call
 */
function viewSnapshotHandler(
  args: unknown,
  { versioningService }: Pick<McpCradle, "versioningService">
): ToolResponse {
  const validation = validateToolArgs<ViewSnapshotArgs>(ViewSnapshotSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber, version } = validation.data;

  const snapshotData = versioningService.viewSnapshot(issueNumber, version);

  return successResponse(snapshotData);
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleGetSnapshotHistory = createMcpHandler(getSnapshotHistoryHandler);
export const handleRevertToSnapshot = createMcpHandler(revertToSnapshotHandler);
export const handleViewSnapshot = createMcpHandler(viewSnapshotHandler);

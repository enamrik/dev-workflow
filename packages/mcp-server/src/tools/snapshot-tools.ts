/**
 * Snapshot/versioning MCP tools
 */

import type {
  SqliteIssueRepository,
  VersioningService,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

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

/**
 * Service context for snapshot handlers
 */
export interface SnapshotToolContext {
  issueRepository: SqliteIssueRepository;
  versioningService: VersioningService;
}

/**
 * Handle get_snapshot_history tool call
 */
export function handleGetSnapshotHistory(
  ctx: SnapshotToolContext,
  args: { issueId?: string; issueNumber?: number }
): ToolResponse {
  const { issueId, issueNumber } = args;

  // Resolve issue number from ID if needed
  let resolvedIssueNumber = issueNumber;
  if (!resolvedIssueNumber && issueId) {
    const issue = ctx.issueRepository.findById(issueId);
    if (!issue) {
      return errorResponse(`Issue not found: ${issueId}`);
    }
    resolvedIssueNumber = issue.number;
  }

  if (!resolvedIssueNumber) {
    return errorResponse("Either issueId or issueNumber is required");
  }

  const history = ctx.versioningService.getSnapshotHistory(resolvedIssueNumber);

  return successResponse(history);
}

/**
 * Handle revert_to_snapshot tool call
 */
export function handleRevertToSnapshot(
  ctx: SnapshotToolContext,
  args: { issueNumber: number; version: number; notes?: string }
): ToolResponse {
  const { issueNumber, version, notes } = args;

  const result = ctx.versioningService.revertToSnapshot(
    issueNumber,
    version,
    "claude-agent",
    notes
  );

  return successResponse(result);
}

/**
 * Handle view_snapshot tool call
 */
export function handleViewSnapshot(
  ctx: SnapshotToolContext,
  args: { issueNumber: number; version: number }
): ToolResponse {
  const { issueNumber, version } = args;

  const snapshotData = ctx.versioningService.viewSnapshot(issueNumber, version);

  return successResponse(snapshotData);
}

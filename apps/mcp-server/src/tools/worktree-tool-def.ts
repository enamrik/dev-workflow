/**
 * Worktree Tool Definitions
 *
 * MCP tool definitions and handler functions for worktree operations.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import type { WorktreeTool } from "./worktree-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const worktreeToolDefinitions: ToolDefinition[] = [
  {
    name: "list_worktrees",
    description:
      "List all active git worktrees with their status and disk usage. Worktrees provide isolated environments for parallel task execution.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "prune_stale_worktrees",
    description:
      "Remove stale worktrees that are no longer linked to the filesystem. This cleans up orphaned worktree references.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle list_worktrees tool call
 */
export const handleListWorktrees = createMcpHandler(
  async (_args: unknown, { worktreeTool }: { worktreeTool: WorktreeTool }) => {
    const result = await worktreeTool.listWorktrees();
    return successResponse(result);
  }
);

/**
 * Handle prune_stale_worktrees tool call
 */
export const handlePruneStaleWorktrees = createMcpHandler(
  async (_args: unknown, { worktreeTool }: { worktreeTool: WorktreeTool }) => {
    const result = await worktreeTool.pruneStaleWorktrees();
    return successResponse(result);
  }
);

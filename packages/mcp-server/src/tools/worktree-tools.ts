/**
 * Worktree-related MCP tools
 *
 * Handlers follow the pattern: (cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import {
  NodeGitWorktreeService,
  type GitWorktreeService,
  type WorktreeInfo,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import { createNoArgsHandler } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";

/**
 * Tool definitions for worktree operations
 */
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
// Helper Functions
// =============================================================================

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle list_worktrees tool call
 */
async function listWorktreesHandler({
  projectRoot,
}: Pick<McpCradle, "projectRoot">): Promise<ToolResponse> {
  try {
    const gitWorktreeService: GitWorktreeService = new NodeGitWorktreeService(projectRoot);

    // Check if git is available
    const gitAvailable = await gitWorktreeService.checkGitAvailable();
    if (!gitAvailable) {
      return errorResponse("Not a git repository or git is not available");
    }

    const worktrees = await gitWorktreeService.listWorktrees();

    // Separate main worktree from task worktrees
    const mainWorktree = worktrees.find((w) => w.isMain);
    const taskWorktrees = worktrees.filter((w) => !w.isMain);

    // Calculate total disk usage
    const totalDiskUsage = taskWorktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0);

    const result: {
      mainWorktree: WorktreeInfo | undefined;
      taskWorktrees: WorktreeInfo[];
      summary: {
        totalWorktrees: number;
        taskWorktrees: number;
        totalDiskUsage: string;
      };
    } = {
      mainWorktree,
      taskWorktrees,
      summary: {
        totalWorktrees: worktrees.length,
        taskWorktrees: taskWorktrees.length,
        totalDiskUsage: formatBytes(totalDiskUsage),
      },
    };

    return successResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to list worktrees: ${message}`);
  }
}

/**
 * Handle prune_stale_worktrees tool call
 */
async function pruneStaleWorktreesHandler({
  projectRoot,
}: Pick<McpCradle, "projectRoot">): Promise<ToolResponse> {
  try {
    const gitWorktreeService: GitWorktreeService = new NodeGitWorktreeService(projectRoot);

    // Check if git is available
    const gitAvailable = await gitWorktreeService.checkGitAvailable();
    if (!gitAvailable) {
      return errorResponse("Not a git repository or git is not available");
    }

    // Get worktree count before pruning
    const beforeWorktrees = await gitWorktreeService.listWorktrees();
    const beforeCount = beforeWorktrees.filter((w) => !w.isMain).length;

    // Prune stale worktrees
    await gitWorktreeService.pruneWorktrees();

    // Get worktree count after pruning
    const afterWorktrees = await gitWorktreeService.listWorktrees();
    const afterCount = afterWorktrees.filter((w) => !w.isMain).length;

    const prunedCount = beforeCount - afterCount;

    return successResponse({
      success: true,
      prunedCount,
      message:
        prunedCount > 0 ? `Pruned ${prunedCount} stale worktree(s)` : "No stale worktrees found",
      remainingWorktrees: afterCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to prune worktrees: ${message}`);
  }
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleListWorktrees = createNoArgsHandler(listWorktreesHandler);
export const handlePruneStaleWorktrees = createNoArgsHandler(pruneStaleWorktreesHandler);

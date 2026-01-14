/**
 * WorktreeTool - Git worktree operations
 *
 * Provides operations for listing and managing git worktrees
 * used for parallel task execution.
 */

import {
  NodeGitWorktreeService,
  type GitWorktreeService,
  type WorktreeInfo,
} from "@dev-workflow/core";

// =============================================================================
// Types
// =============================================================================

export interface ListWorktreesResult {
  mainWorktree: WorktreeInfo | undefined;
  taskWorktrees: WorktreeInfo[];
  summary: {
    totalWorktrees: number;
    taskWorktrees: number;
    totalDiskUsage: string;
  };
}

export interface PruneStaleWorktreesResult {
  success: boolean;
  prunedCount: number;
  message: string;
  remainingWorktrees: number;
}

// =============================================================================
// WorktreeTool Class
// =============================================================================

export class WorktreeTool {
  private readonly gitWorktreeService: GitWorktreeService;

  constructor(projectRoot: string) {
    this.gitWorktreeService = new NodeGitWorktreeService(projectRoot);
  }

  /**
   * List all active git worktrees with their status and disk usage.
   */
  async listWorktrees(): Promise<ListWorktreesResult> {
    // Check if git is available
    const gitAvailable = await this.gitWorktreeService.checkGitAvailable();
    if (!gitAvailable) {
      throw new Error("Not a git repository or git is not available");
    }

    const worktrees = await this.gitWorktreeService.listWorktrees();

    // Separate main worktree from task worktrees
    const mainWorktree = worktrees.find((w) => w.isMain);
    const taskWorktrees = worktrees.filter((w) => !w.isMain);

    // Calculate total disk usage
    const totalDiskUsage = taskWorktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0);

    return {
      mainWorktree,
      taskWorktrees,
      summary: {
        totalWorktrees: worktrees.length,
        taskWorktrees: taskWorktrees.length,
        totalDiskUsage: this.formatBytes(totalDiskUsage),
      },
    };
  }

  /**
   * Remove stale worktrees that are no longer linked to the filesystem.
   */
  async pruneStaleWorktrees(): Promise<PruneStaleWorktreesResult> {
    // Check if git is available
    const gitAvailable = await this.gitWorktreeService.checkGitAvailable();
    if (!gitAvailable) {
      throw new Error("Not a git repository or git is not available");
    }

    // Get worktree count before pruning
    const beforeWorktrees = await this.gitWorktreeService.listWorktrees();
    const beforeCount = beforeWorktrees.filter((w) => !w.isMain).length;

    // Prune stale worktrees
    await this.gitWorktreeService.pruneWorktrees();

    // Get worktree count after pruning
    const afterWorktrees = await this.gitWorktreeService.listWorktrees();
    const afterCount = afterWorktrees.filter((w) => !w.isMain).length;

    const prunedCount = beforeCount - afterCount;

    return {
      success: true,
      prunedCount,
      message:
        prunedCount > 0 ? `Pruned ${prunedCount} stale worktree(s)` : "No stale worktrees found",
      remainingWorktrees: afterCount,
    };
  }

  /**
   * Format bytes into human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

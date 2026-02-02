/**
 * listWorktrees - List all active git worktrees with status and disk usage
 *
 * Separates main worktree from task worktrees and calculates disk usage.
 */

import { GitWorktreeServiceTag } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { WorktreeInfo } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { Effect } from "@dev-workflow/effect";

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

// =============================================================================
// Operation
// =============================================================================

export function listWorktrees() {
  return Effect.gen(function* () {
    const gitWorktreeService = yield* GitWorktreeServiceTag;

    const gitAvailable = yield* Effect.promise(() => gitWorktreeService.checkGitAvailable());
    if (!gitAvailable) {
      throw new Error("Not a git repository or git is not available");
    }

    const worktrees = yield* Effect.promise(() => gitWorktreeService.listWorktrees());

    const mainWorktree = worktrees.find((w) => w.isMain);
    const taskWorktrees = worktrees.filter((w) => !w.isMain);
    const totalDiskUsage = taskWorktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0);

    return {
      mainWorktree,
      taskWorktrees,
      summary: {
        totalWorktrees: worktrees.length,
        taskWorktrees: taskWorktrees.length,
        totalDiskUsage: formatBytes(totalDiskUsage),
      },
    } satisfies ListWorktreesResult;
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

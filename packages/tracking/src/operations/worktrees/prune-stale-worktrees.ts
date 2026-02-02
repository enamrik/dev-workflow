/**
 * pruneStaleWorktrees - Remove stale worktrees no longer on disk
 *
 * Cleans up orphaned worktree references and reports results.
 */

import { GitWorktreeServiceTag } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Types
// =============================================================================

export interface PruneStaleWorktreesResult {
  success: boolean;
  prunedCount: number;
  message: string;
  remainingWorktrees: number;
}

// =============================================================================
// Operation
// =============================================================================

export function pruneStaleWorktrees() {
  return Effect.gen(function* () {
    const gitWorktreeService = yield* GitWorktreeServiceTag;

    const gitAvailable = yield* Effect.promise(() => gitWorktreeService.checkGitAvailable());
    if (!gitAvailable) {
      throw new Error("Not a git repository or git is not available");
    }

    const beforeWorktrees = yield* Effect.promise(() => gitWorktreeService.listWorktrees());
    const beforeCount = beforeWorktrees.filter((w) => !w.isMain).length;

    yield* Effect.promise(() => gitWorktreeService.pruneWorktrees());

    const afterWorktrees = yield* Effect.promise(() => gitWorktreeService.listWorktrees());
    const afterCount = afterWorktrees.filter((w) => !w.isMain).length;

    const prunedCount = beforeCount - afterCount;

    return {
      success: true,
      prunedCount,
      message:
        prunedCount > 0 ? `Pruned ${prunedCount} stale worktree(s)` : "No stale worktrees found",
      remainingWorktrees: afterCount,
    } satisfies PruneStaleWorktreesResult;
  });
}

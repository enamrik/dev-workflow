/**
 * pruneWorktrees - Prune stale worktrees for a project
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { validateInput, ProjectsResolver, EntityNotFoundError } from "@dev-workflow/tracking";
import { WorktreeServiceFactoryTag } from "../service-tags.js";

// =============================================================================
// Schema
// =============================================================================

export const PruneWorktreesSchema = z.object({
  projectId: z.string().min(1),
});
export type PruneWorktreesInput = z.infer<typeof PruneWorktreesSchema>;

// =============================================================================
// Types
// =============================================================================

export interface PruneWorktreesResult {
  success: boolean;
  pruned: number;
}

// =============================================================================
// Operation
// =============================================================================

export function pruneWorktrees(input: PruneWorktreesInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const createWorktreeService = yield* WorktreeServiceFactoryTag;

    const validated = validateInput(PruneWorktreesSchema, input);
    const allProjects = yield* projectsResolver.getAllProjects();
    const project = allProjects.find((p) => p.projectId === validated.projectId);

    if (!project) {
      throw new EntityNotFoundError("Project", validated.projectId);
    }

    if (!project.gitRoot) {
      throw new Error(
        "Project config.json not found. Run 'dev-workflow init' in the project directory first."
      );
    }

    const worktreeService = createWorktreeService(project.gitRoot);

    const beforeCount = (yield* worktreeService.listWorktrees()).filter((w) => !w.isMain).length;
    yield* worktreeService.pruneWorktrees();
    const afterCount = (yield* worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

    return { success: true, pruned: beforeCount - afterCount } satisfies PruneWorktreesResult;
  });
}

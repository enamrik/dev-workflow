/**
 * pruneWorktrees - Prune stale worktrees for a project
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { validateInput, ProjectsResolver, EntityNotFoundError } from "@dev-workflow/tracking";
import { WorktreeServiceFactoryTag } from "../di/service-tags";

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

    return yield* Effect.promise(async (): Promise<PruneWorktreesResult> => {
      const validated = validateInput(PruneWorktreesSchema, input);
      const allProjects = await projectsResolver.getAllProjects();
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

      const beforeCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;
      await worktreeService.pruneWorktrees();
      const afterCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

      return { success: true, pruned: beforeCount - afterCount };
    });
  });
}

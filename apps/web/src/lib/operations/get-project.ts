/**
 * getProject - Get a single project by slug
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { validateInput, ProjectsResolver, type ProjectInfo } from "@dev-workflow/tracking";

// =============================================================================
// Schema
// =============================================================================

export const GetProjectSchema = z.object({
  projectSlug: z.string().min(1),
});
export type GetProjectInput = z.infer<typeof GetProjectSchema>;

// =============================================================================
// Operation
// =============================================================================

export function getProject(input: GetProjectInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;

    return yield* Effect.promise(async (): Promise<ProjectInfo> => {
      const validated = validateInput(GetProjectSchema, input);
      return projectsResolver.getProjectBySlug(validated.projectSlug);
    });
  });
}

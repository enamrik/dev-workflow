/**
 * getProject - Get a single project by slug
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { validateInput, ProjectsResolver } from "@dev-workflow/tracking";

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

    const validated = validateInput(GetProjectSchema, input);
    return yield* projectsResolver.getProjectBySlug(validated.projectSlug);
  });
}

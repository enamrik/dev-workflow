/**
 * Get Project Endpoint — GET /api/projects/:project
 */

import { Effect } from "@dev-workflow/effect";
import { getProject } from "../operations/get-project.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const getProjectEndpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(yield* getProject({ projectSlug: params["project"] ?? "" }));
    }),
});

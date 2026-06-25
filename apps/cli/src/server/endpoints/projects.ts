/**
 * List Projects Endpoint — GET /api/projects
 */

import { Effect } from "@dev-workflow/effect";
import { listProjectsWithSync } from "../operations/list-projects.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const projects = createApiEndpoint({
  handler: (_req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      return json({
        projects: yield* listProjectsWithSync(),
      });
    }),
});

/**
 * Task Dependencies Endpoint — GET /api/projects/:project/tasks/:taskId/dependencies
 */

import { Effect } from "@dev-workflow/effect";
import { getTaskDependencies } from "../operations/get-task-dependencies.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const taskDependencies = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(yield* getTaskDependencies({ taskId: params["taskId"] ?? "" }));
    }),
});

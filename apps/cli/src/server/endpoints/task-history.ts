/**
 * Task Status History Endpoint — GET /api/projects/:project/tasks/:taskId/history
 */

import { Effect } from "@dev-workflow/effect";
import { getTaskStatusHistory } from "../operations/get-task-status-history.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const taskHistory = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(yield* getTaskStatusHistory({ taskId: params["taskId"] ?? "" }));
    }),
});

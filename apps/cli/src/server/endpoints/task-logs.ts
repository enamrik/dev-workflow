/**
 * Task Execution Logs Endpoint — GET /api/projects/:project/tasks/:taskId/logs
 */

import { Effect } from "@dev-workflow/effect";
import { getTaskExecutionLogs } from "../operations/get-task-execution-logs.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const taskLogs = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(yield* getTaskExecutionLogs({ taskId: params["taskId"] ?? "" }));
    }),
});

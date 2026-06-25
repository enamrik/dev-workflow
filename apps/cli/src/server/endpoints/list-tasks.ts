/**
 * List Tasks Endpoint — GET /api/tasks
 */

import { Effect } from "@dev-workflow/effect";
import { listAllTasksForBoard } from "../operations/list-all-tasks-for-board.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const listTasks = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return json(
        yield* listAllTasksForBoard({ projectFilter: url.searchParams.get("project") ?? undefined })
      );
    }),
});

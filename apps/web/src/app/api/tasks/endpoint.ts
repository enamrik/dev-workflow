/**
 * List Tasks Endpoint
 *
 * Returns all tasks for the board view (kanban) with worker assignments.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { listAllTasksForBoard } from "@/lib/operations/list-all-tasks-for-board";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return NextResponse.json(
        yield* listAllTasksForBoard({ projectFilter: url.searchParams.get("project") ?? undefined })
      );
    }),
});

/**
 * Task Status History Endpoint
 *
 * Returns the status change history for a task.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getTaskStatusHistory } from "@/lib/operations/get-task-status-history";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* getTaskStatusHistory({ taskId: params["taskId"] ?? "" }));
    }),
});

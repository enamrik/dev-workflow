/**
 * Task Dependencies Endpoint
 *
 * Returns the dependency tasks for a task (the tasks this task depends on).
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getTaskDependencies } from "@/lib/operations/get-task-dependencies";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* getTaskDependencies({ taskId: params["taskId"] ?? "" }));
    }),
});

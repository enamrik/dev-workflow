/**
 * List Projects Endpoint
 *
 * Returns all available projects with their GitHub sync configuration.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { listProjectsWithSync } from "@/lib/operations/list-projects";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json({
        projects: yield* listProjectsWithSync(),
      });
    }),
});

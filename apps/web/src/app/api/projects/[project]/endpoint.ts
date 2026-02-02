/**
 * Get Project Endpoint
 *
 * Returns project info by slug.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getProject } from "@/lib/operations/get-project";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* getProject({ projectSlug: params["project"] ?? "" }));
    }),
});

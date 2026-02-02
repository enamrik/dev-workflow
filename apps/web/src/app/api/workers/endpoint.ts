/**
 * List Workers Endpoint
 *
 * Returns worker data including enriched queue entries and worker details.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getWorkerData } from "@/lib/operations/get-worker-data";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* getWorkerData());
    }),
});

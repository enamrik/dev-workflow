/**
 * List Issues Endpoint
 *
 * Returns all issues across projects with plan info and computed status.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { listAllIssues } from "@/lib/operations/list-all-issues";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return NextResponse.json(
        yield* listAllIssues({ projectFilter: url.searchParams.get("project") ?? undefined })
      );
    }),
});

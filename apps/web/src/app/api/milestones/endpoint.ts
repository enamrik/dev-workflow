/**
 * List Milestones Endpoint
 *
 * Returns milestones with issue details and progress.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getMilestonesWithDetails } from "@/lib/operations/list-all-milestones";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return NextResponse.json(
        yield* getMilestonesWithDetails({
          projectFilter: url.searchParams.get("project") ?? undefined,
          sourceFilter: url.searchParams.get("source") ?? undefined,
        })
      );
    }),
});

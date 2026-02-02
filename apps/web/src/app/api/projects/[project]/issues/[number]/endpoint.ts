/**
 * Get Issue with Details Endpoint
 *
 * Returns an issue with its plan and tasks.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { getIssueDetails } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const endpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return NextResponse.json(
        yield* getIssueDetails({
          projectSlug: params["project"]!,
          issueNumber: Number(params["number"]),
          includePlan: true,
        })
      );
    }),
});

/**
 * Get Issue with Details Endpoint — GET /api/projects/:project/issues/:number
 */

import { Effect } from "@dev-workflow/effect";
import { getIssueDetails } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

export const getIssueDetailsEndpoint = createApiEndpoint({
  handler: (_req: Request, params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(
        yield* getIssueDetails({
          projectSlug: params["project"]!,
          issueNumber: Number(params["number"]),
          includePlan: true,
        })
      );
    }),
});

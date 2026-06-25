/**
 * List Milestones Endpoint — GET /api/milestones
 */

import { Effect } from "@dev-workflow/effect";
import { getMilestonesWithDetails } from "../operations/list-all-milestones.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const milestones = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return json(
        yield* getMilestonesWithDetails({
          projectFilter: url.searchParams.get("project") ?? undefined,
          sourceFilter: url.searchParams.get("source") ?? undefined,
        })
      );
    }),
});

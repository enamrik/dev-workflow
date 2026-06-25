/**
 * List Issues Endpoint — GET /api/issues
 */

import { Effect } from "@dev-workflow/effect";
import { listAllIssues } from "../operations/list-all-issues.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const listIssues = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return json(
        yield* listAllIssues({ projectFilter: url.searchParams.get("project") ?? undefined })
      );
    }),
});

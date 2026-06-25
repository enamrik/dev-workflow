/**
 * List Workers Endpoint — GET /api/workers
 */

import { Effect } from "@dev-workflow/effect";
import { getWorkerData } from "../operations/get-worker-data.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const workers = createApiEndpoint({
  handler: (_req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      return json(yield* getWorkerData());
    }),
});

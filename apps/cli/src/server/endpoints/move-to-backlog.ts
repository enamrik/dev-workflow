/**
 * Move to Backlog Endpoint — POST /api/issues/:issueNumber/move-to-backlog
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { activateIssue } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
});

export const moveToBacklog = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return json(yield* activateIssue({ ...body, issueNumber: Number(params["issueNumber"]) }));
    }),
});

/**
 * Move to Ready Endpoint — POST /api/issues/:issueNumber/move-to-ready
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { moveIssueTasks } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
});

export const moveToReady = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return json(
        yield* moveIssueTasks({
          ...body,
          issueNumber: Number(params["issueNumber"]),
          direction: "ready" as const,
        })
      );
    }),
});

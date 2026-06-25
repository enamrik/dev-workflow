/**
 * Task Abandon Endpoint — POST /api/tasks/:taskId/abandon
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { abandonTask } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

const BodySchema = z.object({
  reason: z.string().optional(),
  abandonedBy: z.string().optional(),
});

export const abandonTaskEndpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return json(yield* abandonTask({ ...body, taskId: params["taskId"]! }));
    }),
});

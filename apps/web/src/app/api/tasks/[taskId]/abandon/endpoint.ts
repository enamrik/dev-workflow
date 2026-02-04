/**
 * Task Abandon Endpoint
 *
 * Abandons a task.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { abandonTask } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

const BodySchema = z.object({
  reason: z.string().optional(),
  abandonedBy: z.string().optional(),
});

export const endpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* abandonTask({ ...body, taskId: params["taskId"]! }));
    }),
});

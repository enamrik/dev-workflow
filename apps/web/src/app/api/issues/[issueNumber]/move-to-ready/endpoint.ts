/**
 * Move to Ready Endpoint
 *
 * Moves all BACKLOG tasks to READY status for an issue.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { moveIssueTasks } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
});

export const endpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return NextResponse.json(
        yield* moveIssueTasks({
          ...body,
          issueNumber: Number(params["issueNumber"]),
          direction: "ready" as const,
        })
      );
    }),
});

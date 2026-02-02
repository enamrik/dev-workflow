/**
 * Task Transition Endpoint
 *
 * Transitions a task to a new status with full validation.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { transitionTask } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
  targetStatus: z.enum([
    "PLANNED",
    "BACKLOG",
    "READY",
    "IN_PROGRESS",
    "PR_REVIEW",
    "COMPLETED",
    "ABANDONED",
  ]),
  changedBy: z.string().optional(),
});

export const endpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return NextResponse.json(
        yield* transitionTask({
          projectSlug: body.projectSlug,
          taskId: params["taskId"]!,
          toStatus: body.targetStatus,
          changedBy: body.changedBy,
        })
      );
    }),
});

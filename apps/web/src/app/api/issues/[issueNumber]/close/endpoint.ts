/**
 * Close Issue Endpoint
 *
 * Closes an issue and abandons incomplete tasks.
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { closeIssue } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
  force: z.boolean().optional().default(false),
  closedBy: z.string().optional(),
});

export const endpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return NextResponse.json(
        yield* closeIssue({ ...body, issueNumber: Number(params["issueNumber"]) })
      );
    }),
});

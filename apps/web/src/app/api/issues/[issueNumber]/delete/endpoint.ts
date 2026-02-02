/**
 * Delete Issue Endpoint
 *
 * Soft deletes an issue (only allowed for PLANNED issues).
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { deleteIssue } from "@dev-workflow/tracking";
import { createApiEndpoint } from "@/lib/di/bootstrap";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
  deletedBy: z.string().optional().default("system"),
});

export const endpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return NextResponse.json(
        yield* deleteIssue({ ...body, issueNumber: Number(params["issueNumber"]) })
      );
    }),
});

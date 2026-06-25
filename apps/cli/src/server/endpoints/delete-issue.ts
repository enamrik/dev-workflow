/**
 * Delete Issue Endpoint — DELETE /api/issues/:issueNumber/delete
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { deleteIssue } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
  deletedBy: z.string().optional().default("system"),
});

export const deleteIssueEndpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return json(yield* deleteIssue({ ...body, issueNumber: Number(params["issueNumber"]) }));
    }),
});

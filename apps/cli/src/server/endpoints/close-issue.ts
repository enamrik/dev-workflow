/**
 * Close Issue Endpoint — POST /api/issues/:issueNumber/close
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { closeIssue } from "@dev-workflow/tracking";
import { createApiEndpoint, json } from "../bootstrap.js";

const BodySchema = z.object({
  projectSlug: z.string().min(1),
  force: z.boolean().optional().default(false),
  closedBy: z.string().optional(),
});

export const closeIssueEndpoint = createApiEndpoint({
  bodySchema: BodySchema,
  handler: (_req: Request, params: Record<string, string>, body: z.infer<typeof BodySchema>) =>
    Effect.gen(function* () {
      return json(yield* closeIssue({ ...body, issueNumber: Number(params["issueNumber"]) }));
    }),
});

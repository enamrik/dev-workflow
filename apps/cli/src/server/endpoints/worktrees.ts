/**
 * Worktrees Endpoints
 *
 * GET  /api/worktrees — list worktrees with task information enrichment
 * POST /api/worktrees — prune stale worktrees
 */

import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { getWorktreesWithTaskInfo } from "../operations/get-worktrees-with-task-info.js";
import { pruneWorktrees } from "../operations/prune-worktrees.js";
import { createApiEndpoint, json } from "../bootstrap.js";

export const listWorktrees = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return json({
        worktrees: yield* getWorktreesWithTaskInfo({
          projectFilter: url.searchParams.get("project") ?? undefined,
        }),
      });
    }),
});

const PruneBodySchema = z.object({
  projectId: z.string().min(1),
});

export const pruneWorktreesEndpoint = createApiEndpoint({
  bodySchema: PruneBodySchema,
  handler: (
    _req: Request,
    _params: Record<string, string>,
    body: z.infer<typeof PruneBodySchema>
  ) =>
    Effect.gen(function* () {
      return json(yield* pruneWorktrees(body));
    }),
});

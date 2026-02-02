/**
 * Worktrees Endpoints
 *
 * GET: List worktrees with task information enrichment
 * POST: Prune stale worktrees
 */

import { NextResponse } from "next/server";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";
import { getWorktreesWithTaskInfo } from "@/lib/operations/get-worktrees-with-task-info";
import { pruneWorktrees } from "@/lib/operations/prune-worktrees";
import { createApiEndpoint } from "@/lib/di/bootstrap";

export const listEndpoint = createApiEndpoint({
  handler: (req: Request, _params: Record<string, string>) =>
    Effect.gen(function* () {
      const url = new URL(req.url);
      return NextResponse.json({
        worktrees: yield* getWorktreesWithTaskInfo({
          projectFilter: url.searchParams.get("project") ?? undefined,
        }),
      });
    }),
});

const PruneBodySchema = z.object({
  projectId: z.string().min(1),
});

export const pruneEndpoint = createApiEndpoint({
  bodySchema: PruneBodySchema,
  handler: (
    _req: Request,
    _params: Record<string, string>,
    body: z.infer<typeof PruneBodySchema>
  ) =>
    Effect.gen(function* () {
      return NextResponse.json(yield* pruneWorktrees(body));
    }),
});

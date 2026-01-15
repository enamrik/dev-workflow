/**
 * Worktrees Endpoints
 *
 * GET: List worktrees with task information enrichment
 * POST: Prune stale worktrees
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

export async function listWorktreesEndpoint(
  req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectFilter = url.searchParams.get("project") ?? undefined;

  const worktrees = await projectAppService.getWorktreesWithTaskInfo(projectFilter);
  return NextResponse.json({ worktrees });
}

const PruneWorktreesSchema = z.object({
  action: z.literal("prune"),
  projectId: z.string().min(1),
});

export async function pruneWorktreesEndpoint(
  req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(PruneWorktreesSchema, body);

  const result = await projectAppService.pruneWorktrees(validated.projectId);
  return NextResponse.json(result);
}

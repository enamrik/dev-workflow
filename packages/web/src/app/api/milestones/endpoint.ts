/**
 * List Milestones Endpoint
 *
 * Returns milestones with issue details and progress.
 */

import { NextResponse } from "next/server";
import type { WebCradle } from "@/lib/di/container";

export async function listMilestonesEndpoint(
  req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectFilter = url.searchParams.get("project") ?? undefined;
  const sourceFilter = url.searchParams.get("source") ?? undefined;

  const milestones = await projectAppService.getMilestonesWithDetails(projectFilter, sourceFilter);
  return NextResponse.json(milestones);
}

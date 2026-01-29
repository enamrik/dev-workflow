/**
 * List Issues Endpoint
 *
 * Returns all issues across projects with plan info and computed status.
 */

import { NextResponse } from "next/server";
import type { WebCradle } from "@/lib/di/container";

export async function listIssuesEndpoint(
  req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectFilter = url.searchParams.get("project") ?? undefined;

  const issues = await projectAppService.listAllIssues(projectFilter);

  return NextResponse.json(issues);
}

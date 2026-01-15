/**
 * List Tasks Endpoint
 *
 * Returns all tasks for the board view (kanban) with worker assignments.
 */

import { NextResponse } from "next/server";
import type { WebCradle } from "@/lib/di/container";

export async function listTasksEndpoint(
  req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectFilter = url.searchParams.get("project") ?? undefined;

  const result = await projectAppService.listAllTasksForBoard(projectFilter);

  return NextResponse.json(result);
}

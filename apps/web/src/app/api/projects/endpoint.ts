/**
 * List Projects Endpoint
 *
 * Returns all available projects with their GitHub sync configuration.
 */

import { NextResponse } from "next/server";
import type { WebCradle } from "@/lib/di/container";

export async function listProjectsEndpoint(
  _req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const projects = await projectAppService.listProjectsWithSync();

  return NextResponse.json({
    projects,
  });
}

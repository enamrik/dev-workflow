/**
 * Get Project Endpoint
 *
 * Returns project info by slug.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const GetProjectSchema = z.object({
  project: z.string().min(1),
});

export async function getProjectEndpoint(
  _req: Request,
  params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const validated = parseJsonBody(GetProjectSchema, params);
  const project = await projectAppService.getProject(validated.project);
  return NextResponse.json(project);
}

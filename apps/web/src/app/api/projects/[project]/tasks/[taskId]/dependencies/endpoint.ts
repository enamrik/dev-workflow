/**
 * Task Dependencies Endpoint
 *
 * Returns the dependency tasks for a task (the tasks this task depends on).
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const GetTaskDependenciesSchema = z.object({
  taskId: z.string().min(1),
});

export async function getTaskDependenciesEndpoint(
  _req: Request,
  params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const validated = parseJsonBody(GetTaskDependenciesSchema, params);
  const dependencies = await projectAppService.getTaskDependencies(validated.taskId);
  return NextResponse.json(dependencies);
}

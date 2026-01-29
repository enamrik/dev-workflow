/**
 * Task Status History Endpoint
 *
 * Returns the status change history for a task.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const GetTaskHistorySchema = z.object({
  taskId: z.string().min(1),
});

export async function getTaskStatusHistoryEndpoint(
  _req: Request,
  params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const validated = parseJsonBody(GetTaskHistorySchema, params);
  const history = await projectAppService.getTaskStatusHistory(validated.taskId);
  return NextResponse.json(history);
}

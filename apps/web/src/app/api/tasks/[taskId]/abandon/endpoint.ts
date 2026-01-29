/**
 * Task Abandon Endpoint
 *
 * Abandons a task with full cleanup.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const AbandonTaskSchema = z.object({
  taskId: z.string().min(1),
  projectSlug: z.string().min(1),
  reason: z.string().optional(),
});

export async function abandonTaskEndpoint(
  req: Request,
  params: Record<string, string>,
  { taskAppService }: Pick<WebCradle, "taskAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(AbandonTaskSchema, {
    ...body,
    taskId: params["taskId"],
  });

  const result = await taskAppService.abandonTaskWithCleanup(
    validated.projectSlug,
    validated.taskId,
    validated.reason
  );

  return NextResponse.json({
    success: true,
    task: {
      id: result.task.id,
      number: result.task.number,
      title: result.task.title,
      status: "ABANDONED",
      previousStatus: result.previousStatus,
    },
    cleanup: result.cleanup,
  });
}

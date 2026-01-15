/**
 * Task Transition Endpoint
 *
 * Transitions a task to a new status with full validation.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const TransitionTaskSchema = z.object({
  taskId: z.string().min(1),
  targetStatus: z.enum(["BACKLOG", "READY", "IN_PROGRESS", "PR_REVIEW", "COMPLETED", "ABANDONED"]),
  projectSlug: z.string().min(1),
});

export async function transitionTaskEndpoint(
  req: Request,
  params: Record<string, string>,
  { taskAppService }: Pick<WebCradle, "taskAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(TransitionTaskSchema, {
    ...body,
    taskId: params["taskId"],
  });

  const result = await taskAppService.transitionTask(
    validated.projectSlug,
    validated.taskId,
    validated.targetStatus
  );

  return NextResponse.json({
    success: true,
    task: {
      id: result.task.id,
      number: result.task.number,
      title: result.task.title,
      status: result.task.status,
      previousStatus: result.previousStatus,
    },
  });
}

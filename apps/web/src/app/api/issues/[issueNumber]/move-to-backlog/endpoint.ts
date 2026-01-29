/**
 * Move to Backlog Endpoint
 *
 * Activates a PLANNED issue to OPEN and transitions PLANNED tasks to BACKLOG.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const MoveToBacklogSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
});

export async function moveToBacklogEndpoint(
  req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(MoveToBacklogSchema, {
    ...body,
    issueNumber: params["issueNumber"],
  });

  const result = await issueAppService.activateIssue(validated.projectSlug, validated.issueNumber);

  return NextResponse.json({
    success: true,
    issue: {
      id: result.issue.id,
      number: result.issue.number,
      title: result.issue.title,
      previousStatus: result.previousStatus,
      newStatus: result.issue.status,
    },
    tasksActivated: result.tasksActivated,
    tasks: result.tasks,
  });
}

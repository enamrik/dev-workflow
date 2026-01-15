/**
 * Move to Ready Endpoint
 *
 * Moves all BACKLOG tasks to READY status for an issue.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const MoveToReadySchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
});

export async function moveToReadyEndpoint(
  req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(MoveToReadySchema, {
    ...body,
    issueNumber: params["issueNumber"],
  });

  const result = await issueAppService.moveToReady(validated.projectSlug, validated.issueNumber);

  return NextResponse.json({
    success: true,
    issue: {
      id: result.issue.id,
      number: result.issue.number,
      title: result.issue.title,
      status: result.issue.status,
    },
    tasksReadied: result.tasksUpdated,
    tasks: result.tasks,
  });
}

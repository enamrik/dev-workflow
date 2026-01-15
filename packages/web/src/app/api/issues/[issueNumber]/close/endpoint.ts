/**
 * Close Issue Endpoint
 *
 * Pure function that validates input, calls AppService, and returns NextResponse.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const CloseIssueSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
});

export async function closeIssueEndpoint(
  req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(CloseIssueSchema, {
    ...body,
    issueNumber: params["issueNumber"],
  });

  const result = await issueAppService.closeIssue(validated.projectSlug, validated.issueNumber);

  return NextResponse.json({
    success: true,
    issue: {
      id: result.issue.id,
      number: result.issue.number,
      title: result.issue.title,
      status: result.issue.status,
    },
    abandonedTasks: result.abandonedTasks.map((t) => ({
      id: t.task.id,
      number: t.task.number,
      title: t.task.title,
    })),
    externalIssueClosed: result.externalIssueClosed,
  });
}

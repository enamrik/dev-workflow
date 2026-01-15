/**
 * Delete Issue Endpoint
 *
 * Soft deletes an issue (only allowed for PLANNED issues).
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const DeleteIssueSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
});

export async function deleteIssueEndpoint(
  req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const validated = parseJsonBody(DeleteIssueSchema, {
    ...body,
    issueNumber: params["issueNumber"],
  });

  const issue = await issueAppService.deleteIssue(validated.projectSlug, validated.issueNumber);

  return NextResponse.json({
    success: true,
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
    },
  });
}

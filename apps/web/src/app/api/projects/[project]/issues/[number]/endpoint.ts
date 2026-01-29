/**
 * Get Issue with Details Endpoint
 *
 * Returns an issue with its plan and tasks.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/di/bootstrap";
import type { WebCradle } from "@/lib/di/container";

const GetIssueSchema = z.object({
  project: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

export async function getIssueWithDetailsEndpoint(
  _req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const validated = parseJsonBody(GetIssueSchema, params);

  const result = await issueAppService.getIssueWithDetails(validated.project, validated.number);
  return NextResponse.json(result);
}

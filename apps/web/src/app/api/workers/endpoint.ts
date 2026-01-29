/**
 * List Workers Endpoint
 *
 * Returns worker data including enriched queue entries and worker details.
 */

import { NextResponse } from "next/server";
import type { WebCradle } from "@/lib/di/container";

export async function listWorkersEndpoint(
  _req: Request,
  _params: Record<string, string>,
  { projectAppService }: Pick<WebCradle, "projectAppService">
): Promise<NextResponse> {
  const workerData = await projectAppService.getWorkerData();
  return NextResponse.json(workerData);
}

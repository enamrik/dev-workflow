import { NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects
 *
 * Returns all projects grouped by data source.
 * Response format: { sources: DataSource[], projects: Project[] }
 *
 * The UI uses this to:
 * 1. Show a source dropdown (which database to view)
 * 2. Show a project dropdown filtered by selected source
 */
export async function GET() {
  try {
    const service = getMultiProjectService();
    const result = await service.listProjectsBySource();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

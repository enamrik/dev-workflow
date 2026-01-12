import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver } from "@/server";

interface RouteParams {
  params: Promise<{
    project: string;
  }>;
}

/**
 * GET /api/projects/[project]
 *
 * Returns project info by slug.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { project: projectSlug } = await params;

    const registry = new ProjectsResolver();
    try {
      const project = await registry.getProjectBySlug(projectSlug);
      return NextResponse.json(project);
    } catch {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

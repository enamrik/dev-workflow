import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry } from "@/server";

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

    const registry = new DataSourceRegistry();
    const project = await registry.findProjectBySlug(projectSlug);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { ProjectsResolver } from "@/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects
 *
 * Returns all projects grouped by data source.
 * Response format: { sources: Source[], projects: ProjectInfo[] }
 *
 * The UI uses this to:
 * 1. Show a source dropdown (which database to view)
 * 2. Show a project dropdown filtered by selected source
 */
export async function GET() {
  try {
    const registry = new ProjectsResolver();
    const sources = await registry.getAllSources();
    const projects = sources.flatMap((s) => s.projects);
    return NextResponse.json({
      sources: sources.map((s) => s.sourceInfo),
      projects,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

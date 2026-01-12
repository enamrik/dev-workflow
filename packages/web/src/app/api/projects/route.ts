import { NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider } from "@/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects
 *
 * Returns all available projects with their GitHub sync configuration.
 * Projects are identified by unique slugs, regardless of data source.
 */
export async function GET() {
  const sourceProvider = new DbSourceProvider();
  try {
    const resolver = new ProjectsResolver();
    const projects = await resolver.getAllProjects();

    // Enrich projects with database data (githubSync)
    const enrichedProjects = await resolver.enrichWithDbData(projects, async (sourceInfo) => {
      const source = sourceProvider.getOrCreate(sourceInfo);
      await source.provision();
      return source;
    });

    // Map ProjectInfo to frontend Project type (projectId -> id)
    const mappedProjects = enrichedProjects.map((p) => ({
      id: p.projectId,
      name: p.name,
      slug: p.slug,
      gitRoot: p.gitRoot,
      githubSync: p.githubSync ?? null,
    }));

    return NextResponse.json({
      projects: mappedProjects,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

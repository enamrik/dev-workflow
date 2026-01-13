import React from "react";
import { render } from "ink";
import { ProjectsResolver, type ProjectInfo } from "@dev-workflow/core";
import { KanbanBoard } from "../components/KanbanBoard.js";
import { useMultiProjectKanbanData } from "../hooks/useKanbanData.js";

/**
 * Board command options
 */
export interface BoardOptions {
  /** Refresh interval in seconds (default: 3) */
  interval?: number;
  /** Comma-separated list of project slugs to filter */
  slugs?: string;
}

/**
 * Main board app component
 */
function BoardApp({
  projects,
  intervalMs,
}: {
  projects: ProjectInfo[];
  intervalMs: number;
}): React.ReactElement {
  const {
    data,
    error,
    loading,
    refresh,
    currentProjectIndex,
    setCurrentProjectIndex,
    projectCount,
  } = useMultiProjectKanbanData(projects, intervalMs);

  return (
    <KanbanBoard
      data={data}
      loading={loading}
      error={error}
      intervalMs={intervalMs}
      onRefresh={refresh}
      currentProjectIndex={currentProjectIndex}
      projectCount={projectCount}
      onProjectChange={setCurrentProjectIndex}
    />
  );
}

/**
 * Run the board command
 */
export async function runBoard(options: BoardOptions = {}): Promise<void> {
  const intervalMs = (options.interval ?? 3) * 1000;

  // Resolve all projects from ~/.track/projects
  const resolver = new ProjectsResolver();
  let projects: ProjectInfo[];

  try {
    projects = await resolver.getAllProjects();
  } catch (error) {
    console.error("❌ Failed to load projects.");
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    console.error("\nMake sure you have at least one initialized project.");
    console.error("Run 'dev-workflow init' in a git repository to initialize.");
    process.exit(1);
  }

  if (projects.length === 0) {
    console.error("❌ No projects found.");
    console.error("\nRun 'dev-workflow init' in a git repository to initialize a project.");
    process.exit(1);
  }

  // Filter by slugs if provided
  if (options.slugs) {
    const requestedSlugs = options.slugs.split(",").map((s) => s.trim());
    const validSlugs = new Set(projects.map((p) => p.slug));

    // Check for invalid slugs and warn
    const invalidSlugs = requestedSlugs.filter((s) => !validSlugs.has(s));
    if (invalidSlugs.length > 0) {
      console.warn(`⚠️  Unknown project slugs (ignoring): ${invalidSlugs.join(", ")}`);
    }

    // Filter to only requested valid slugs
    const filteredProjects = projects.filter((p) => requestedSlugs.includes(p.slug));

    if (filteredProjects.length === 0) {
      console.error("❌ No valid projects found for the specified slugs.");
      console.error(`   Available slugs: ${Array.from(validSlugs).join(", ")}`);
      process.exit(1);
    }

    projects = filteredProjects;
  }

  // Start the Ink app
  const { waitUntilExit } = render(<BoardApp projects={projects} intervalMs={intervalMs} />);

  // Wait for user to exit
  await waitUntilExit();
}

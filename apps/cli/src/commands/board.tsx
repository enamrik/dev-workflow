/**
 * Board Command
 *
 * Display a live terminal Kanban board of tasks (refreshes automatically).
 * Uses the Awilix DI pattern with React context provider for dependency injection.
 */

import React, { useState, useEffect } from "react";
import { render } from "ink";
import { asValue } from "awilix";
import { type ProjectInfo } from "@dev-workflow/tracking";
import { KanbanBoard } from "../components/KanbanBoard.js";
import { useMultiProjectKanbanData, useKanbanActions } from "../hooks/useKanbanData.js";
import { createCliContainer, DIContainerProvider, useDeps, handleCliError } from "../di/index.js";

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
 * Internal board app component that loads projects using DI
 */
function BoardAppInternal({
  intervalMs,
  slugs,
}: {
  intervalMs: number;
  slugs?: string;
}): React.ReactElement {
  const projectsResolver = useDeps("projectsResolver");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load projects on mount
  useEffect(() => {
    let mounted = true;

    async function loadProjects(): Promise<void> {
      try {
        let loadedProjects = await projectsResolver.getAllProjects();

        if (loadedProjects.length === 0) {
          setLoadError(
            "No projects found.\nRun 'dev-workflow init' in a git repository to initialize a project."
          );
          return;
        }

        // Filter by slugs if provided
        if (slugs) {
          const requestedSlugs = slugs.split(",").map((s) => s.trim());
          const validSlugs = new Set(loadedProjects.map((p) => p.slug));

          // Check for invalid slugs and warn
          const invalidSlugs = requestedSlugs.filter((s) => !validSlugs.has(s));
          if (invalidSlugs.length > 0) {
            console.warn(`⚠️  Unknown project slugs (ignoring): ${invalidSlugs.join(", ")}`);
          }

          // Filter to only requested valid slugs
          const filteredProjects = loadedProjects.filter((p) => requestedSlugs.includes(p.slug));

          if (filteredProjects.length === 0) {
            setLoadError(
              `No valid projects found for the specified slugs.\nAvailable slugs: ${Array.from(validSlugs).join(", ")}`
            );
            return;
          }

          loadedProjects = filteredProjects;
        }

        if (mounted) {
          setProjects(loadedProjects);
          setIsLoading(false);
        }
      } catch (error) {
        if (mounted) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadError(
            `Failed to load projects: ${message}\nMake sure you have at least one initialized project.`
          );
        }
      }
    }

    loadProjects();

    return () => {
      mounted = false;
    };
  }, [projectsResolver, slugs]);

  // Use the multi-project kanban data hook
  const {
    data,
    error,
    loading,
    refresh,
    currentProjectIndex,
    setCurrentProjectIndex,
    projectCount,
  } = useMultiProjectKanbanData(projects, intervalMs);

  // Get current project info for actions
  const currentProject = projects[currentProjectIndex];

  // Use the actions hook for the current project
  const actions = useKanbanActions(
    currentProject?.sourceInfo.connectionString ?? "",
    currentProject?.projectId ?? "",
    refresh
  );

  // Show load error if project loading failed
  if (loadError) {
    return (
      <KanbanBoard
        data={null}
        loading={false}
        error={new Error(loadError)}
        intervalMs={intervalMs}
        onRefresh={() => {}}
      />
    );
  }

  return (
    <KanbanBoard
      data={data}
      loading={isLoading || loading}
      error={error}
      intervalMs={intervalMs}
      onRefresh={refresh}
      currentProjectIndex={currentProjectIndex}
      projectCount={projectCount}
      onProjectChange={setCurrentProjectIndex}
      actions={actions}
    />
  );
}

/**
 * Run the board command with DI container
 *
 * Creates a container, wraps the React app with DIContainerProvider,
 * and disposes the container when the app exits.
 */
export async function runBoard(options: BoardOptions = {}): Promise<void> {
  const intervalMs = (options.interval ?? 3) * 1000;
  const container = createCliContainer();

  try {
    // Register runtime values
    container.register({
      workingDirectory: asValue(process.cwd()),
      packageRoot: asValue(""), // Not needed for board
    });

    // Start the Ink app with DI provider
    const { waitUntilExit } = render(
      <DIContainerProvider container={container}>
        <BoardAppInternal intervalMs={intervalMs} slugs={options.slugs} />
      </DIContainerProvider>
    );

    // Wait for user to exit
    await waitUntilExit();
  } catch (error) {
    handleCliError(error);
  } finally {
    // Dispose container on exit
    await container.dispose();
  }
}

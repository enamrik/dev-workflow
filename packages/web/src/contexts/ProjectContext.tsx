"use client";

import { createContext, useContext, useCallback, useMemo, useEffect } from "react";
import { useProjects, useUrlState } from "@/hooks";
import type { Project, DataSource } from "@/lib/types";

interface ProjectContextValue {
  /** Selected project ID (empty string = all projects) */
  projectId: string;
  setProjectId: (projectId: string) => void;
  /** Selected source ID (for API filtering - derived from selected project) */
  sourceId: string;
  /** All available data sources */
  sources: DataSource[];
  /** All projects */
  allProjects: Project[];
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useProjects();
  const { state, setProperty } = useUrlState();

  // Extract sources and projects from data
  const sources = data?.sources ?? [];
  const allProjects = data?.projects ?? [];

  const projectId = state.project ?? "";

  // Derive sourceId from selected project (for API filtering)
  const sourceId = useMemo(() => {
    if (!projectId) return sources[0]?.id ?? "";
    const project = allProjects.find((p) => p.id === projectId);
    return project?.sourceId ?? sources[0]?.id ?? "";
  }, [projectId, allProjects, sources]);

  const setProjectId = useCallback(
    (newProjectId: string) => {
      setProperty("project", newProjectId || undefined);
    },
    [setProperty]
  );

  // Auto-select project if there's only one
  useEffect(() => {
    if (allProjects.length !== 1) return;
    const singleProject = allProjects[0];
    if (singleProject && projectId !== singleProject.id) {
      setProperty("project", singleProject.id);
    }
  }, [allProjects, projectId, setProperty]);

  const value = useMemo(
    () => ({
      projectId,
      setProjectId,
      sourceId,
      sources,
      allProjects,
      isLoading,
    }),
    [projectId, setProjectId, sourceId, sources, allProjects, isLoading]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return context;
}

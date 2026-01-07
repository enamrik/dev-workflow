"use client";

import { createContext, useContext, useCallback, useMemo } from "react";
import { useProjects, useUrlState } from "@/hooks";
import type { Project, DataSource } from "@/lib/types";

interface ProjectContextValue {
  /** Selected project ID (empty string = all projects) */
  projectId: string;
  setProjectId: (projectId: string) => void;
  /** Selected source ID (empty string = all sources) */
  sourceId: string;
  setSourceId: (sourceId: string) => void;
  /** All available data sources */
  sources: DataSource[];
  /** All projects (filtered by selected source if one is selected) */
  projects: Project[];
  /** All projects (unfiltered) */
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
  const sourceId = state.source ?? "";

  const setProjectId = useCallback(
    (newProjectId: string) => {
      setProperty("project", newProjectId || undefined);
    },
    [setProperty]
  );

  const setSourceId = useCallback(
    (newSourceId: string) => {
      setProperty("source", newSourceId || undefined);
      // Clear project selection when source changes
      setProperty("project", undefined);
    },
    [setProperty]
  );

  // Filter projects by selected source
  const projects = useMemo(() => {
    if (!sourceId) {
      return allProjects;
    }
    return allProjects.filter((p) => p.sourceId === sourceId);
  }, [allProjects, sourceId]);

  const value = useMemo(
    () => ({
      projectId,
      setProjectId,
      sourceId,
      setSourceId,
      sources,
      projects,
      allProjects,
      isLoading,
    }),
    [projectId, setProjectId, sourceId, setSourceId, sources, projects, allProjects, isLoading]
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

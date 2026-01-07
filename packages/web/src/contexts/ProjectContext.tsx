"use client";

import { createContext, useContext, useCallback, useMemo, useEffect } from "react";
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

  // Auto-select first source when none is selected, or clear invalid source IDs
  useEffect(() => {
    if (sources.length === 0) return; // Still loading

    // Check if current sourceId is valid
    const isValidSource = sourceId && sources.some((s) => s.id === sourceId);

    if (!isValidSource && sources[0]) {
      // Either no source selected, or selected source doesn't exist - select first
      setProperty("source", sources[0].id);
    }
  }, [sourceId, sources, setProperty]);

  // Filter projects by selected source
  const projects = useMemo(() => {
    if (!sourceId) {
      // While waiting for auto-select to kick in, return empty array
      // This prevents showing wrong data momentarily
      return [];
    }
    return allProjects.filter((p) => p.sourceId === sourceId);
  }, [allProjects, sourceId]);

  // Find current source to check its type
  const currentSource = sources.find((s) => s.id === sourceId);
  const isLocalSource = currentSource?.type === "local";

  // Auto-select project for local sources (single project by design)
  useEffect(() => {
    if (!isLocalSource) return;
    if (projects.length !== 1) return;

    const singleProject = projects[0];
    if (singleProject && projectId !== singleProject.id) {
      setProperty("project", singleProject.id);
    }
  }, [isLocalSource, projects, projectId, setProperty]);

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

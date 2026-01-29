"use client";

import { createContext, useContext, useCallback, useMemo, useEffect } from "react";
import { useProjects, useUrlState } from "@/hooks";
import type { Project } from "@/lib/types";

interface ProjectContextValue {
  /** Selected project ID (empty string = all projects) */
  projectId: string;
  setProjectId: (projectId: string) => void;
  /** All projects */
  allProjects: Project[];
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useProjects();
  const { state, setProperty } = useUrlState();

  const allProjects = data?.projects ?? [];
  const projectId = state.project ?? "";

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
      allProjects,
      isLoading,
    }),
    [projectId, setProjectId, allProjects, isLoading]
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

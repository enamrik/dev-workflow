"use client";

import { createContext, useContext, useCallback, useMemo } from "react";
import { useProjects, useUrlState } from "@/hooks";
import type { Project } from "@/lib/types";

interface ProjectContextValue {
  projectId: string;
  setProjectId: (projectId: string) => void;
  projects: Project[];
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data: projects = [], isLoading } = useProjects();
  const { state, setProperty } = useUrlState();

  const projectId = state.project ?? "";

  const setProjectId = useCallback(
    (newProjectId: string) => {
      setProperty("project", newProjectId || undefined);
    },
    [setProperty]
  );

  const value = useMemo(
    () => ({
      projectId,
      setProjectId,
      projects,
      isLoading,
    }),
    [projectId, setProjectId, projects, isLoading]
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

"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useProjects } from "@/hooks";
import type { Project } from "@/lib/types";

const STORAGE_KEY = "dev-workflow-selected-project";

interface ProjectContextValue {
  projectId: string;
  setProjectId: (projectId: string) => void;
  projects: Project[];
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: projects = [], isLoading } = useProjects();
  const prevPathnameRef = useRef(pathname);
  const isUserActionRef = useRef(false);

  // Initialize from localStorage (source of truth), fall back to URL
  const [projectId, setProjectIdState] = useState<string>(() => {
    if (typeof window === "undefined") return "";

    // localStorage is the source of truth
    const storedProject = localStorage.getItem(STORAGE_KEY);
    if (storedProject) return storedProject;

    // Fall back to URL param
    const urlProject = new URLSearchParams(window.location.search).get("project");
    return urlProject ?? "";
  });

  // When pathname changes (navigation to new page), restore project param to URL
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Skip if this is a user-initiated change (not a navigation)
    if (isUserActionRef.current) {
      isUserActionRef.current = false;
      return;
    }

    const didNavigate = prevPathnameRef.current !== pathname;
    prevPathnameRef.current = pathname;

    // Only restore on actual page navigation
    if (!didNavigate) return;

    const urlProject = searchParams.get("project");
    const storedProject = localStorage.getItem(STORAGE_KEY);

    // If we navigated to a new page and have a stored project but URL doesn't have it
    if (!urlProject && storedProject) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set("project", storedProject);
      router.replace(`${pathname}?${newParams.toString()}`);
      setProjectIdState(storedProject);
    } else if (urlProject && urlProject !== projectId) {
      // URL has a project from a shared link - use it
      setProjectIdState(urlProject);
      localStorage.setItem(STORAGE_KEY, urlProject);
    }
  }, [pathname, searchParams, router, projectId]);

  const setProjectId = useCallback((newProjectId: string) => {
    // Mark this as a user action so the effect doesn't override it
    isUserActionRef.current = true;

    setProjectIdState(newProjectId);

    // Persist to localStorage
    if (newProjectId) {
      localStorage.setItem(STORAGE_KEY, newProjectId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    // Update URL
    const newParams = new URLSearchParams(searchParams.toString());
    if (newProjectId) {
      newParams.set("project", newProjectId);
    } else {
      newParams.delete("project");
    }
    router.push(`${pathname}?${newParams.toString()}`);
  }, [searchParams, pathname, router]);

  const value = useMemo(() => ({
    projectId,
    setProjectId,
    projects,
    isLoading,
  }), [projectId, setProjectId, projects, isLoading]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return context;
}

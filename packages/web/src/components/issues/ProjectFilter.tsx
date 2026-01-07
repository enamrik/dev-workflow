"use client";

import { Select, GitHubLink } from "../ui";
import type { Project, DataSource } from "@/lib/types";

interface SourceProjectFilterProps {
  sources: DataSource[];
  projects: Project[];
  sourceId: string;
  projectId: string;
  onSourceChange: (sourceId: string) => void;
  onProjectChange: (projectId: string) => void;
}

/**
 * Combined source and project filter.
 *
 * Shows source dropdown only when multiple sources are available.
 * Projects are filtered by the selected source.
 *
 * For local sources (one project per database), the project dropdown is hidden
 * since "All Projects" makes no sense when there's only one project by design.
 */
export function SourceProjectFilter({
  sources,
  projects,
  sourceId,
  projectId,
  onSourceChange,
  onProjectChange,
}: SourceProjectFilterProps) {
  const hasMultipleSources = sources.length > 1;

  // Find current source to check its type
  const currentSource = sources.find((s) => s.id === sourceId);
  const isLocalSource = currentSource?.type === "local";

  // Source options (no "All sources" - each datasource is independent)
  const sourceOptions = sources.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  // Project options - for local sources with single project, don't show "All projects"
  const showAllProjectsOption = !isLocalSource && projects.length > 1;
  const projectOptions = [
    ...(showAllProjectsOption ? [{ value: "", label: "All projects" }] : []),
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  // For local sources, hide project dropdown entirely (single project by design)
  const showProjectDropdown = !isLocalSource && projects.length > 1;

  // Find selected project to check for GitHub links
  // For local sources with single project, use that project even if projectId isn't set
  const selectedProject = projectId
    ? projects.find((p) => p.id === projectId)
    : isLocalSource && projects.length === 1
      ? projects[0]
      : null;
  const githubRepoUrl = selectedProject?.githubSync?.repoUrl;
  const githubProjectUrl = selectedProject?.githubSync?.projectUrl;

  if (projects.length === 0 && sources.length === 0) {
    return null;
  }

  // GitHub links component - shown in multiple places
  const GitHubLinks = () => (
    <>
      {githubRepoUrl && (
        <GitHubLink url={githubRepoUrl} label="Repo" tooltip={`View GitHub Repository`} />
      )}
      {githubProjectUrl && (
        <GitHubLink url={githubProjectUrl} label="Project" tooltip={`View GitHub Project`} />
      )}
    </>
  );

  return (
    <div className="flex items-center gap-3">
      {/* Source dropdown - only show when multiple sources */}
      {hasMultipleSources && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Source:</label>
          <Select options={sourceOptions} value={sourceId} onChange={onSourceChange} />
        </div>
      )}

      {/* Project dropdown - hidden for local sources (single project by design) */}
      {showProjectDropdown && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Project:</label>
          <Select options={projectOptions} value={projectId} onChange={onProjectChange} />
          <GitHubLinks />
        </div>
      )}

      {/* Show GitHub links even when project dropdown is hidden */}
      {!showProjectDropdown && <GitHubLinks />}
    </div>
  );
}

/**
 * Simple project filter (backwards compatibility).
 * @deprecated Use SourceProjectFilter for new code.
 */
interface ProjectFilterProps {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}

export function ProjectFilter({ projects, value, onChange }: ProjectFilterProps) {
  if (projects.length === 0) {
    return null;
  }

  const options = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  // Find selected project to check for GitHub links
  const selectedProject = value ? projects.find((p) => p.id === value) : null;
  const githubRepoUrl = selectedProject?.githubSync?.repoUrl;
  const githubProjectUrl = selectedProject?.githubSync?.projectUrl;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">Project:</label>
      <Select options={options} value={value} onChange={onChange} />
      {githubRepoUrl && (
        <GitHubLink url={githubRepoUrl} label="Repo" tooltip={`View GitHub Repository`} />
      )}
      {githubProjectUrl && (
        <GitHubLink url={githubProjectUrl} label="Project" tooltip={`View GitHub Project`} />
      )}
    </div>
  );
}

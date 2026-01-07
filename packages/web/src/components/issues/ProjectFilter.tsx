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

  // Source options
  const sourceOptions = [
    { value: "", label: "All sources" },
    ...sources.map((s) => ({
      value: s.id,
      label: s.name,
    })),
  ];

  // Project options
  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  // Find selected project to check for GitHub Project link
  const selectedProject = projectId ? projects.find((p) => p.id === projectId) : null;
  const githubProjectUrl = selectedProject?.githubSync?.projectUrl;

  if (projects.length === 0 && sources.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      {/* Source dropdown - only show when multiple sources */}
      {hasMultipleSources && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Source:</label>
          <Select options={sourceOptions} value={sourceId} onChange={onSourceChange} />
        </div>
      )}

      {/* Project dropdown */}
      {projects.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Project:</label>
          <Select options={projectOptions} value={projectId} onChange={onProjectChange} />
          {githubProjectUrl && (
            <GitHubLink
              url={githubProjectUrl}
              label="Project"
              tooltip={`View GitHub Project: ${githubProjectUrl}`}
            />
          )}
        </div>
      )}
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

  // Find selected project to check for GitHub Project link
  const selectedProject = value ? projects.find((p) => p.id === value) : null;
  const githubProjectUrl = selectedProject?.githubSync?.projectUrl;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">Project:</label>
      <Select options={options} value={value} onChange={onChange} />
      {githubProjectUrl && (
        <GitHubLink
          url={githubProjectUrl}
          label="Project"
          tooltip={`View GitHub Project: ${githubProjectUrl}`}
        />
      )}
    </div>
  );
}

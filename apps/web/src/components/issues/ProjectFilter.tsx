"use client";

import { Select, GitHubLink } from "../ui";
import type { Project } from "@/lib/types";

interface ProjectFilterProps {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}

/**
 * Project filter dropdown with GitHub links.
 * Shows "All projects" option when multiple projects are available.
 */
export function ProjectFilter({ projects, value, onChange }: ProjectFilterProps) {
  if (projects.length === 0) {
    return null;
  }

  const options = [
    ...(projects.length > 1 ? [{ value: "", label: "All projects" }] : []),
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  // Find selected project to check for GitHub links
  // If only one project and nothing selected, use that project
  const selectedProject = value
    ? projects.find((p) => p.id === value)
    : projects.length === 1
      ? projects[0]
      : null;
  const githubRepoUrl = selectedProject?.syncConfig?.repoUrl;
  const githubProjectUrl = selectedProject?.syncConfig?.projectUrl;

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

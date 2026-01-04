"use client";

import { Select, GitHubLink } from "../ui";
import type { Project } from "@/lib/types";

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

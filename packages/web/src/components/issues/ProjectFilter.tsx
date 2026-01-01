"use client";

import { Select } from "../ui";
import type { Project } from "@/lib/types";

interface ProjectFilterProps {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}

export function ProjectFilter({ projects, value, onChange }: ProjectFilterProps) {
  if (projects.length <= 1) {
    return null;
  }

  const options = projects.map((p) => ({
    value: p.id,
    label: p.id,
  }));

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">Project:</label>
      <Select
        options={options}
        value={value}
        onChange={onChange}
        placeholder="All projects"
      />
    </div>
  );
}

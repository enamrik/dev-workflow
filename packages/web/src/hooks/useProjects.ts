"use client";

import { useQuery } from "@tanstack/react-query";
import { getProjects } from "@/lib/api";
import type { ProjectsResponse } from "@/lib/types";

export function useProjects() {
  return useQuery<ProjectsResponse>({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}

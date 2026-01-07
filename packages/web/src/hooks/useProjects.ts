"use client";

import { useQuery } from "@tanstack/react-query";
import { getProjects } from "@/lib/api";
import type { ProjectsBySource } from "@/lib/types";

export function useProjects() {
  return useQuery<ProjectsBySource>({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}

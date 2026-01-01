"use client";

import { useQuery } from "@tanstack/react-query";
import { getProjects } from "@/lib/api";
import type { Project } from "@/lib/types";

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}

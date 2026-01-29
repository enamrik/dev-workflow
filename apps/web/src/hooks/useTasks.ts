"use client";

import { useQuery } from "@tanstack/react-query";
import { getTasks, type TasksFilters } from "@/lib/api";
import type { TasksResponse } from "@/lib/types";

export function useTasks(filters?: TasksFilters) {
  return useQuery<TasksResponse>({
    queryKey: ["tasks", filters],
    queryFn: () => getTasks(filters),
  });
}

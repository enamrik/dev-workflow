import { apiClient, buildQueryString } from "./client";
import type { TasksResponse } from "./types";

export interface TasksFilters {
  project?: string;
  issue?: number;
}

export function getTasks(filters?: TasksFilters): Promise<TasksResponse> {
  const query = buildQueryString({
    project: filters?.project,
    issue: filters?.issue,
  });

  return apiClient<TasksResponse>(`/tasks${query}`);
}

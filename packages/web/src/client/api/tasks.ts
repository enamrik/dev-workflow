import { apiClient, buildQueryString } from "./client";
import type { ProjectIssueWithTasks } from "./types";

export interface TasksFilters {
  project?: string;
  issue?: number;
}

export function getTasks(
  filters?: TasksFilters
): Promise<ProjectIssueWithTasks[]> {
  const query = buildQueryString({
    project: filters?.project,
    issue: filters?.issue,
  });

  return apiClient<ProjectIssueWithTasks[]>(`/tasks${query}`);
}

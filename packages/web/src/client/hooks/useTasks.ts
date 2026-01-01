import { useQuery } from "@tanstack/react-query";
import { getTasks, type ProjectIssueWithTasks, type TasksFilters } from "../api";

export function useTasks(filters?: TasksFilters) {
  return useQuery<ProjectIssueWithTasks[]>({
    queryKey: ["tasks", filters],
    queryFn: () => getTasks(filters),
  });
}

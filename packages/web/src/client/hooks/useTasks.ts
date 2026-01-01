import { useQuery } from "@tanstack/react-query";
import { getTasks, type TasksResponse, type TasksFilters } from "../api";

export function useTasks(filters?: TasksFilters) {
  return useQuery<TasksResponse>({
    queryKey: ["tasks", filters],
    queryFn: () => getTasks(filters),
  });
}

import { useQuery } from "@tanstack/react-query";
import { getProjects, type Project } from "../api";

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}

import { apiClient } from "./client";
import type { Project } from "./types";

export function getProjects(): Promise<Project[]> {
  return apiClient<Project[]>("/projects");
}

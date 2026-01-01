import { apiClient, buildQueryString } from "./client";
import type { MilestoneWithIssues } from "./types";

export interface MilestonesFilters {
  project?: string;
}

export function getMilestones(
  filters?: MilestonesFilters
): Promise<MilestoneWithIssues[]> {
  const query = buildQueryString({
    project: filters?.project,
  });

  return apiClient<MilestoneWithIssues[]>(`/milestones${query}`);
}

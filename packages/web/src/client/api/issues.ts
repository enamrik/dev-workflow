import { apiClient, buildQueryString } from "./client";
import type { ProjectIssueWithPlanInfo, IssueDetail } from "./types";

export interface IssuesFilters {
  project?: string;
}

export function getIssues(
  filters?: IssuesFilters
): Promise<ProjectIssueWithPlanInfo[]> {
  const query = buildQueryString({
    project: filters?.project,
  });

  return apiClient<ProjectIssueWithPlanInfo[]>(`/issues${query}`);
}

export function getIssue(
  projectId: string,
  issueNumber: number
): Promise<IssueDetail> {
  return apiClient<IssueDetail>(
    `/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`
  );
}

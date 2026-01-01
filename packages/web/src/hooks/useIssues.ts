"use client";

import { useQuery } from "@tanstack/react-query";
import { getIssues, getIssue, type IssuesFilters } from "@/lib/api";
import type { ProjectIssueWithPlanInfo, IssueDetail } from "@/lib/types";

export function useIssues(filters?: IssuesFilters) {
  return useQuery<ProjectIssueWithPlanInfo[]>({
    queryKey: ["issues", filters],
    queryFn: () => getIssues(filters),
  });
}

export function useIssue(projectId: string | undefined, issueNumber: number | undefined) {
  return useQuery<IssueDetail>({
    queryKey: ["issue", projectId, issueNumber],
    queryFn: () => {
      if (!projectId || issueNumber === undefined) {
        throw new Error("projectId and issueNumber are required");
      }
      return getIssue(projectId, issueNumber);
    },
    enabled: !!projectId && issueNumber !== undefined,
  });
}

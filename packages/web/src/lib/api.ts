import type {
  Project,
  ProjectIssueWithPlanInfo,
  IssueDetail,
  TasksResponse,
  MilestoneWithIssues,
} from "./types";
import { ApiError } from "./types";

const API_BASE = "/api";

async function apiClient<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || response.statusText);
  }

  return response.json();
}

function buildQueryString(
  params: Record<string, string | number | undefined>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

// Projects
export function getProjects(): Promise<Project[]> {
  return apiClient<Project[]>("/projects");
}

// Issues
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

// Tasks
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

// Milestones
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

import type {
  ProjectsResponse,
  ProjectIssueWithPlanInfo,
  IssueDetail,
  TasksResponse,
  MilestoneWithIssues,
  Worktree,
  Task,
  TaskStatusHistory,
  TaskExecutionLog,
  WorkerData,
} from "./types";
import { ApiError } from "./types";

const API_BASE = "/api";

async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
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

function buildQueryString(params: Record<string, string | number | undefined>): string {
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
export function getProjects(): Promise<ProjectsResponse> {
  return apiClient<ProjectsResponse>("/projects");
}

// Issues
export interface IssuesFilters {
  project?: string;
}

export function getIssues(filters?: IssuesFilters): Promise<ProjectIssueWithPlanInfo[]> {
  const query = buildQueryString({
    project: filters?.project,
  });

  return apiClient<ProjectIssueWithPlanInfo[]>(`/issues${query}`);
}

export function getIssue(projectId: string, issueNumber: number): Promise<IssueDetail> {
  return apiClient<IssueDetail>(`/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`);
}

// Tasks
export interface TasksFilters {
  project?: string;
}

export function getTasks(filters?: TasksFilters): Promise<TasksResponse> {
  const query = buildQueryString({
    project: filters?.project,
  });

  return apiClient<TasksResponse>(`/tasks${query}`);
}

// Milestones
export interface MilestonesFilters {
  project?: string;
}

export function getMilestones(filters?: MilestonesFilters): Promise<MilestoneWithIssues[]> {
  const query = buildQueryString({
    project: filters?.project,
  });

  return apiClient<MilestoneWithIssues[]>(`/milestones${query}`);
}

// Worktrees
export interface WorktreesFilters {
  project?: string;
}

export async function getWorktrees(filters?: WorktreesFilters): Promise<Worktree[]> {
  const query = buildQueryString({
    project: filters?.project,
  });

  const response = await apiClient<{ worktrees: Worktree[] }>(`/worktrees${query}`);
  return response.worktrees;
}

export async function pruneWorktrees(
  projectId: string
): Promise<{ success: boolean; pruned: number }> {
  return apiClient<{ success: boolean; pruned: number }>("/worktrees", {
    method: "POST",
    body: JSON.stringify({ action: "prune", projectId }),
  });
}

// Task Metadata

export function getTaskStatusHistory(
  projectId: string,
  taskId: string
): Promise<TaskStatusHistory[]> {
  return apiClient<TaskStatusHistory[]>(
    `/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/history`
  );
}

export function getTaskExecutionLogs(
  projectId: string,
  taskId: string
): Promise<TaskExecutionLog[]> {
  return apiClient<TaskExecutionLog[]>(
    `/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/logs`
  );
}

export function getTaskDependencies(projectId: string, taskId: string): Promise<Task[]> {
  return apiClient<Task[]>(
    `/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/dependencies`
  );
}

// Workers
export function getWorkerData(): Promise<WorkerData> {
  return apiClient<WorkerData>("/workers");
}

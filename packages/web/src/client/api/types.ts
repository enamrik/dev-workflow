/**
 * API response types for the React client.
 * These mirror the server-side types from @dev-workflow/core.
 */

export interface Issue {
  id: string;
  number: number;
  title: string;
  description: string;
  type: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  acceptanceCriteria: string[];
  projectId: string;
  milestoneId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  issueId: string;
  summary: string;
  approach: string;
  estimatedComplexity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  status: "DRAFT" | "APPROVED" | "IN_PROGRESS" | "COMPLETED";
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  planId: string;
  number: number;
  title: string;
  description: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  estimatedMinutes: number | null;
  acceptanceCriteria: string[];
  labels: string[];
  contextInstructions: string | null;
  isManual: boolean;
  sessionId: string | null;
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  number: number;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  trackDirectory: string;
}

export interface ProjectIssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
}

export interface ProjectIssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
  milestoneNumber?: number;
  milestoneTitle?: string;
}

/**
 * Completed task with project and issue context for Done column
 */
export interface CompletedTask extends Task {
  projectId: string;
  issueNumber: number;
  issueTitle: string;
  issueStatus: string;
}

/**
 * API response for tasks endpoint
 */
export interface TasksResponse {
  issuesWithTasks: ProjectIssueWithTasks[];
  completedTasks: CompletedTask[];
}

export interface IssueDetail {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
}

export interface MilestoneWithIssues {
  milestone: Milestone;
  issues: {
    number: number;
    title: string;
    status: string;
    type: string;
  }[];
  progress: {
    total: number;
    closed: number;
    percentage: number;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

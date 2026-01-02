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
  status: "PENDING" | "IN_PROGRESS" | "PR_REVIEW" | "COMPLETED" | "ABANDONED";
  estimatedMinutes: number | null;
  acceptanceCriteria: string[];
  labels: string[];
  contextInstructions: string | null;
  isManual: boolean;
  sessionId: string | null;
  // Worktree fields
  worktreePath: string | null;
  branchName: string | null;
  // PR fields
  prUrl: string | null;
  prNumber: number | null;
  prStatus: "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | null;
  startedAt?: string;
  submittedForReviewAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Dependencies
  dependsOn?: string[];
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
  name: string;
  trackDirectory: string;
  gitRoot: string;
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
  projectName?: string;
}

/**
 * Completed task with project and issue context for Done column
 */
export interface CompletedTask extends Task {
  projectId: string;
  projectName: string;
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

/**
 * Worktree with project context and optional task association
 */
export interface Worktree {
  projectId: string;
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  diskUsageBytes?: number;
  taskId?: string;
  taskNumber?: number;
  taskTitle?: string;
  taskStatus?: string;
  issueNumber?: number;
}

/**
 * Task status history entry
 */
export interface TaskStatusHistory {
  id: string;
  taskId: string;
  fromStatus: Task["status"];
  toStatus: Task["status"];
  changedBy?: string;
  changedAt: string;
  notes?: string;
  sessionId?: string;
}

/**
 * Task execution log entry
 */
export interface TaskExecutionLog {
  id: string;
  taskId: string;
  sessionId: string;
  message: string;
  filesModified?: string[];
  createdAt: string;
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

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
  status: "BACKLOG" | "READY" | "IN_PROGRESS" | "PR_REVIEW" | "COMPLETED" | "ABANDONED";
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
  projectName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  trackDirectory: string;
  gitRoot: string;
}

/**
 * Computed issue status based on task states.
 * This replaces the dual display of issue.status + taskPhase with a single status.
 *
 * Status rules:
 * - CLOSED: Issue is explicitly closed
 * - COMPLETED: All tasks are COMPLETED or ABANDONED
 * - IN_PROGRESS: Some tasks not completed AND no tasks in BACKLOG (work has started)
 * - READY: Any task is in BACKLOG status (plan exists, work not started)
 * - OPEN: No plan/tasks yet
 */
export type ComputedIssueStatus = "OPEN" | "READY" | "IN_PROGRESS" | "COMPLETED" | "CLOSED";

export interface ProjectIssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
  /**
   * Single computed status based on issue state and task progress.
   */
  computedStatus: ComputedIssueStatus;
  projectName?: string;
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

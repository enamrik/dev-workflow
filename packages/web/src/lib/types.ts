/**
 * API response types for the React client.
 * These mirror the server-side types from @dev-workflow/core.
 */

/**
 * GitHub sync state for an issue
 */
export interface GitHubSyncState {
  githubIssueNumber: number | null;
  githubUrl: string | null;
  githubNodeId: string | null;
  syncStatus: "NOT_SYNCED" | "SYNCED" | "PUSH_FAILED";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  projectItemId: string | null;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  description: string;
  type: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PLANNED" | "OPEN" | "IN_PROGRESS" | "CLOSED";
  acceptanceCriteria: string[];
  projectId: string;
  milestoneId: string | null;
  /** GitHub sync state (optional - only present if synced to GitHub) */
  githubSync?: GitHubSyncState;
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
  number: number; // Sequential task number (1, 2, 3...) - renumbered in PLANNED state, immutable after activation
  title: string;
  description: string;
  type: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
  status: "PLANNED" | "BACKLOG" | "READY" | "IN_PROGRESS" | "PR_REVIEW" | "COMPLETED" | "ABANDONED";
  estimatedMinutes: number | null;
  acceptanceCriteria: string[];
  implementationPlan: string | null;
  isManual: boolean;
  sessionId: string | null;
  // Worktree fields
  worktreePath: string | null;
  branchName: string | null;
  // PR fields
  prUrl: string | null;
  prNumber: number | null;
  prStatus: "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | null;
  /** GitHub sync state (optional - only present if synced to GitHub) */
  githubSync?: GitHubSyncState;
  startedAt?: string;
  submittedForReviewAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Dependencies
  dependsOn?: string[];
  /** Issue number for #issue.task display format (only present for dependency tasks) */
  issueNumber?: number | null;
  // Worker info (present when worker is in WORKING state for this task)
  workerId?: string;
  workerName?: string;
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
  projectSlug?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GitHub issue sync configuration
 */
export interface GitHubIssueSyncConfig {
  enabled: boolean;
  repoUrl?: string;
  projectId?: string;
  projectUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  /** Machine-specific track directory / database path (from config.json) */
  trackDirectory?: string;
  /** Machine-specific git root path (from config.json) */
  gitRoot?: string;
  /** GitHub sync configuration (optional - only present if configured) */
  githubSync?: GitHubIssueSyncConfig | null;
}

/**
 * API response for the projects endpoint.
 */
export interface ProjectsResponse {
  projects: Project[];
}

/**
 * Computed issue status based on task states.
 * This replaces the dual display of issue.status + taskPhase with a single status.
 *
 * Status rules:
 * - PLANNED: Issue is in planning phase (not yet activated)
 * - CLOSED: Issue is explicitly closed
 * - TASKS_DONE: All tasks are COMPLETED or ABANDONED (issue ready to be closed)
 * - IN_PROGRESS: Some tasks not completed AND no tasks in BACKLOG/READY (work has started)
 * - OPEN: Plan exists but work not started (tasks in BACKLOG/READY), or no plan/tasks yet
 */
export type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

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
  projectSlug?: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

export interface ProjectIssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
  milestoneNumber?: number;
  milestoneTitle?: string;
  projectName?: string;
  projectSlug?: string;
}

/**
 * Completed task with project and issue context for Done column
 */
export interface CompletedTask extends Task {
  projectId: string;
  projectName: string;
  projectSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
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
    computedStatus: ComputedIssueStatus;
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

/**
 * Worker status
 */
export type WorkerStatus = "IDLE" | "WORKING" | "DRAINING";

/**
 * Worker with health information
 */
export interface Worker {
  id: string;
  name: string;
  status: WorkerStatus;
  lastHeartbeat: string;
  createdAt: string;
  /** Whether the worker is considered alive (heartbeat within threshold) */
  isAlive: boolean;
  /** Seconds since last heartbeat */
  heartbeatAge: number;
  /** Current task ID if the worker has claimed a task */
  currentTaskId: string | null;
  /** Task number within the issue (enriched from task lookup) */
  taskNumber?: number;
  /** Issue number containing the task (enriched from task lookup) */
  issueNumber?: number;
  /** When the task was started (enriched from task lookup) */
  taskStartedAt?: string;
  /** Total tasks in the issue (enriched from task lookup) */
  totalTasks?: number;
}

/**
 * Dispatch queue entry with health information
 */
export interface DispatchQueueEntry {
  taskId: string;
  workerId: string | null;
  claimedAt: string | null;
  createdAt: string;
  /** Whether the claim is stale (worker is dead) */
  isStale: boolean;
  /** Worker name if claimed */
  workerName: string | null;
  /** Task number within issue */
  taskNumber?: number;
  /** Issue number */
  issueNumber?: number;
  /** Task title */
  taskTitle?: string;
  /** Total tasks in the issue */
  totalTasks?: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number;
  unclaimed: number;
  claimed: number;
  stale: number;
}

/**
 * Worker data response combining workers, queue, and stats
 */
export interface WorkerData {
  workers: Worker[];
  queue: DispatchQueueEntry[];
  stats: QueueStats;
}

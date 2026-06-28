/**
 * BoardQueryService - Application service for kanban board queries
 *
 * Provides unified query logic for kanban board data, used by both
 * CLI board command and Web UI board views.
 *
 * Follows Service Layer Pattern:
 * - Aggregates data from multiple repositories
 * - Provides consistent query behavior across all consumers
 */

import type { Issue } from "../domain/issues/issue.js";
import type { Plan } from "../domain/plans/plan.js";
import type { Task, TaskStatus } from "../domain/tasks/task.js";
import type { DbClient } from "../data-access/db-client.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import { Effect } from "@dev-workflow/effect";

/**
 * Issue with its plan, tasks, and optional milestone info
 */
export interface BoardIssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
  milestone?: {
    number: number;
    title: string;
  };
}

/**
 * A terminal (completed/abandoned) task with its issue context, for the
 * board's Done column. Unlike BoardIssueWithTasks, this is sourced from ALL
 * issues — including terminal (CLOSED) ones — so recently finished work
 * surfaces in Done even after its issue is closed.
 */
export interface CompletedBoardTask {
  task: Task;
  projectId: string;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  issueStatus: string;
}

/**
 * Worker assignment info for a task
 */
export interface WorkerTaskAssignment {
  taskId: string;
  workerId: string;
  workerName: string | null;
}

/**
 * Worker counts for board display
 */
export interface WorkerCounts {
  active: number;
  idle: number;
  dead: number;
  total: number;
}

/**
 * Task with issue context for flat column display
 */
export interface BoardTask {
  id: string;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  taskNumber: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  implementationPlan?: string;
  type: string;
  status: TaskStatus;
  branchName?: string;
  worktreePath?: string;
  prUrl?: string;
  prNumber?: number;
  prStatus?: string;
  githubIssueNumber?: number;
  githubUrl?: string;
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  submittedForReviewAt?: string;
  createdAt: string;
}

/**
 * Column configuration for board display
 */
export interface BoardColumn {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
}

/**
 * Complete board data with columns and worker info
 */
export interface BoardData {
  columns: BoardColumn[];
  workers: WorkerCounts;
  lastUpdated: Date;
}

/**
 * Column configuration
 */
const COLUMN_CONFIG: { status: TaskStatus; label: string }[] = [
  { status: "PLANNED", label: "Planned" },
  { status: "BACKLOG", label: "Backlog" },
  { status: "READY", label: "Ready" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "PR_REVIEW", label: "PR Review" },
  { status: "COMPLETED", label: "Done" },
];

/**
 * BoardQueryService - Provides unified board query logic
 */
export class BoardQueryService {
  constructor(
    private readonly db: DbClient,
    private readonly workerQueueDb?: WorkerQueueDb
  ) {}

  /**
   * Get active issues (not CLOSED) with their plans and tasks
   *
   * Used for the work queue ribbon in the UI.
   * Filters out closed issues at the database level for better performance.
   */
  getActiveIssuesWithTasks(): Effect<BoardIssueWithTasks[]> {
    const self = this;
    return Effect.gen(function* () {
      const issues = yield* self.db.issues.findMany({ excludeStatuses: ["CLOSED"] });
      return yield* self.enrichIssuesWithTasksAndMilestones(issues);
    });
  }

  /**
   * Get all issues with their plans and tasks
   *
   * Returns all issues regardless of status, with their associated
   * plans, tasks, and milestone info.
   *
   * @deprecated Use getActiveIssuesWithTasks() for work queue or getBoardData() for kanban
   */
  getIssuesWithTasks(): Effect<BoardIssueWithTasks[]> {
    const self = this;
    return Effect.gen(function* () {
      const issues = yield* self.db.issues.findMany({});
      return yield* self.enrichIssuesWithTasksAndMilestones(issues);
    });
  }

  /**
   * Get recently finished tasks across ALL issues — including terminal
   * (CLOSED) issues — for the board's Done column.
   *
   * This intentionally differs from getActiveIssuesWithTasks() (which powers
   * the work queue and active columns and excludes CLOSED issues): the Done
   * column must still surface recently completed/abandoned work whose issue
   * has since been closed. Uses the Task.isTerminal trait rather than
   * hardcoded status checks.
   *
   * @param since ISO timestamp; only tasks completed/abandoned on or after this are returned.
   */
  getRecentlyCompletedTasks(since: string): Effect<CompletedBoardTask[]> {
    const self = this;
    return Effect.gen(function* () {
      const allIssuesWithTasks = yield* self.getIssuesWithTasks();

      const completed: CompletedBoardTask[] = [];
      for (const { issue, tasks } of allIssuesWithTasks) {
        for (const task of tasks) {
          if (!task.isTerminal) continue;
          const completionDate = task.completedAt ?? task.abandonedAt;
          if (!completionDate || completionDate < since) continue;

          completed.push({
            task,
            projectId: issue.projectId,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueType: issue.type,
            issueStatus: issue.status,
          });
        }
      }

      return completed;
    });
  }

  /**
   * Enrich issues with their plans, tasks, and milestone info
   */
  private enrichIssuesWithTasksAndMilestones(issues: Issue[]): Effect<BoardIssueWithTasks[]> {
    const self = this;
    return Effect.gen(function* () {
      const result: BoardIssueWithTasks[] = [];

      for (const issue of issues) {
        const plan = yield* self.db.plans.findByIssueId(issue.id);
        const tasks = plan ? yield* self.db.tasks.findByPlanId(plan.id) : [];

        let milestone: { number: number; title: string } | undefined;
        if (issue.milestoneId) {
          const m = yield* self.db.milestones.findById(issue.milestoneId);
          if (m) {
            milestone = { number: m.number, title: m.title };
          }
        }

        result.push({ issue, plan, tasks, milestone });
      }

      return result;
    });
  }

  /**
   * Get worker assignments for tasks
   *
   * Returns a map of taskId -> worker info for tasks being worked on.
   * Only includes tasks where the worker is in WORKING status.
   */
  getWorkerAssignments(): Map<string, WorkerTaskAssignment> {
    const assignments = new Map<string, WorkerTaskAssignment>();

    if (!this.workerQueueDb) {
      return assignments;
    }

    const entries = this.workerQueueDb.findAllEntriesWithHealth();
    for (const entry of entries) {
      if (entry.workerId && entry.status === "WORKING") {
        assignments.set(entry.taskId, {
          taskId: entry.taskId,
          workerId: entry.workerId,
          workerName: entry.workerName,
        });
      }
    }

    return assignments;
  }

  /**
   * Get worker counts
   *
   * Returns counts of active, idle, dead, and total workers.
   */
  getWorkerCounts(): WorkerCounts {
    const counts: WorkerCounts = {
      active: 0,
      idle: 0,
      dead: 0,
      total: 0,
    };

    if (!this.workerQueueDb) {
      return counts;
    }

    const workers = this.workerQueueDb.findAllWorkersWithHealth();
    counts.total = workers.length;

    for (const worker of workers) {
      if (!worker.isAlive) {
        counts.dead++;
      } else if (worker.status === "WORKING") {
        counts.active++;
      } else {
        // IDLE or DRAINING
        counts.idle++;
      }
    }

    return counts;
  }

  /**
   * Get board data with tasks grouped by status columns
   *
   * This is the main method for CLI board display.
   * Returns tasks flattened and grouped by status.
   */
  getBoardData(): Effect<BoardData> {
    const self = this;
    return Effect.gen(function* () {
      const issuesWithTasks = yield* self.getIssuesWithTasks();

      // Flatten all tasks with issue context
      const allTasks: BoardTask[] = [];
      for (const { issue, tasks } of issuesWithTasks) {
        for (const task of tasks) {
          allTasks.push({
            id: task.id,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueType: issue.type,
            taskNumber: task.number,
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            implementationPlan: task.implementationPlan,
            type: task.type,
            status: task.status,
            branchName: task.branchName,
            worktreePath: task.worktreePath,
            prUrl: task.prUrl,
            prNumber: task.prNumber,
            prStatus: task.prStatus,
            githubIssueNumber: task.syncState?.externalId
              ? parseInt(task.syncState.externalId, 10)
              : undefined,
            githubUrl: task.syncState?.externalUrl ?? undefined,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            abandonedAt: task.abandonedAt,
            submittedForReviewAt: task.submittedForReviewAt,
            createdAt: task.createdAt,
          });
        }
      }

      // Group tasks by status
      const columns: BoardColumn[] = COLUMN_CONFIG.map(({ status, label }) => {
        let tasks = allTasks.filter((t) => t.status === status);

        // Include ABANDONED tasks in COMPLETED column
        if (status === "COMPLETED") {
          const abandonedTasks = allTasks.filter((t) => t.status === "ABANDONED");
          tasks = [...tasks, ...abandonedTasks];
        }

        // Sort by appropriate date
        tasks = self.sortTasks(tasks, status);

        // Limit COMPLETED to 20
        if (status === "COMPLETED") {
          tasks = tasks.slice(0, 20);
        }

        return { status, label, tasks };
      });

      return {
        columns,
        workers: self.getWorkerCounts(),
        lastUpdated: new Date(),
      };
    });
  }

  /**
   * Sort tasks by appropriate date field
   */
  private sortTasks(tasks: BoardTask[], status: TaskStatus): BoardTask[] {
    return [...tasks].sort((a, b) => {
      let dateA: string;
      let dateB: string;

      switch (status) {
        case "COMPLETED":
          dateA = a.completedAt ?? a.abandonedAt ?? "";
          dateB = b.completedAt ?? b.abandonedAt ?? "";
          break;
        case "IN_PROGRESS":
          dateA = a.startedAt ?? "";
          dateB = b.startedAt ?? "";
          break;
        case "PR_REVIEW":
          dateA = a.submittedForReviewAt ?? "";
          dateB = b.submittedForReviewAt ?? "";
          break;
        default:
          dateA = a.createdAt;
          dateB = b.createdAt;
      }

      // Descending order (newest first)
      return dateB.localeCompare(dateA);
    });
  }
}

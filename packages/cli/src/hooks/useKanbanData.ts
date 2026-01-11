import { useState, useEffect, useCallback } from "react";
import {
  DataSourceFactory,
  SqliteTaskRepository,
  SqlitePlanRepository,
  SqliteIssueRepository,
  SqliteProjectRepository,
  SqliteWorkerRepository,
  type Issue,
  type Plan,
  type Project,
  type TaskStatus,
} from "@dev-workflow/core";

/**
 * Task with additional context for Kanban display
 */
export interface KanbanTask {
  id: string;
  issueNumber: number;
  taskNumber: number;
  title: string;
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
}

/**
 * Worker counts for display
 */
export interface WorkerCounts {
  active: number;
  idle: number;
  dead: number;
  total: number;
}

/**
 * Kanban board data grouped by status
 */
export interface KanbanData {
  project: Project;
  columns: {
    status: TaskStatus;
    label: string;
    tasks: KanbanTask[];
  }[];
  workers: WorkerCounts;
  lastUpdated: Date;
}

/**
 * Column configuration for display
 */
const COLUMN_CONFIG: { status: TaskStatus; label: string }[] = [
  { status: "PLANNED", label: "Planned" },
  { status: "READY", label: "Ready" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "PR_REVIEW", label: "PR Review" },
  { status: "COMPLETED", label: "Done" },
];

/**
 * Fetch Kanban data from the database
 */
async function fetchKanbanData(dbPath: string, projectId: string): Promise<KanbanData | null> {
  const dataSource = await DataSourceFactory.createSqlite(dbPath);

  try {
    const db = dataSource.getDb();
    const projectRepo = new SqliteProjectRepository(db);
    const issueRepo = new SqliteIssueRepository(db, projectId);
    const planRepo = new SqlitePlanRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const workerRepo = new SqliteWorkerRepository(db);

    // Get project
    const project = await projectRepo.findById(projectId);
    if (!project) {
      return null;
    }

    // Get all issues (including CLOSED for showing completed tasks)
    const allIssues = [
      ...issueRepo.findMany({ status: "PLANNED" }),
      ...issueRepo.findMany({ status: "OPEN" }),
      ...issueRepo.findMany({ status: "IN_PROGRESS" }),
      ...issueRepo.findMany({ status: "CLOSED" }),
    ];

    // Build map of planId -> issue for lookup
    const planToIssue = new Map<string, Issue>();
    const plans: Plan[] = [];

    for (const issue of allIssues) {
      const plan = planRepo.findByIssueId(issue.id);
      if (plan) {
        plans.push(plan);
        planToIssue.set(plan.id, issue);
      }
    }

    // Get all tasks from these plans
    const allTasks: KanbanTask[] = [];

    for (const plan of plans) {
      const issue = planToIssue.get(plan.id);
      if (!issue) continue;

      const tasks = taskRepo.findByPlanId(plan.id);

      for (const task of tasks) {
        allTasks.push({
          id: task.id,
          issueNumber: issue.number,
          taskNumber: task.number,
          title: task.title,
          type: task.type,
          status: task.status,
          branchName: task.branchName,
          worktreePath: task.worktreePath,
          prUrl: task.prUrl,
          prNumber: task.prNumber,
          prStatus: task.prStatus,
          githubIssueNumber: task.githubSync?.githubIssueNumber ?? undefined,
          githubUrl: task.githubSync?.githubUrl ?? undefined,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
        });
      }
    }

    // Group tasks by status
    const columns = COLUMN_CONFIG.map(({ status, label }) => {
      let tasks = allTasks.filter((t) => t.status === status);

      // For COMPLETED, only show last 20, sorted by completedAt desc
      if (status === "COMPLETED") {
        tasks = tasks
          .sort((a, b) => {
            const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return bTime - aTime;
          })
          .slice(0, 20);
      }

      return { status, label, tasks };
    });

    // Get worker counts
    const workersWithHealth = workerRepo.findAllWithHealth();
    const workers: WorkerCounts = {
      active: 0,
      idle: 0,
      dead: 0,
      total: workersWithHealth.length,
    };

    for (const worker of workersWithHealth) {
      if (!worker.isAlive) {
        workers.dead++;
      } else if (worker.status === "WORKING") {
        workers.active++;
      } else {
        // IDLE or DRAINING
        workers.idle++;
      }
    }

    return {
      project,
      columns,
      workers,
      lastUpdated: new Date(),
    };
  } finally {
    dataSource.close();
  }
}

/**
 * React hook for Kanban data with polling
 */
export function useKanbanData(
  dbPath: string,
  projectId: string,
  intervalMs: number = 3000
): {
  data: KanbanData | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<KanbanData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchKanbanData(dbPath, projectId)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dbPath, projectId]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Polling
  useEffect(() => {
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}

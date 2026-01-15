import { useState, useEffect, useCallback } from "react";
import {
  DbSourceProvider,
  BoardQueryService,
  GlobalDbWorkerQueueDb,
  type Project,
  type TaskStatus,
  type BoardTask,
  type ProjectInfo,
} from "@dev-workflow/core";

/**
 * Task with additional context for Kanban display
 * Re-export BoardTask with taskNumber alias for backward compatibility
 */
export interface KanbanTask extends Omit<BoardTask, "issueTitle" | "issueType"> {
  taskNumber: number;
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
 * Issue with plan and tasks for ribbon/details display
 */
export interface KanbanIssue {
  id: string;
  number: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: string;
  status: string;
  priority: string;
  milestone?: {
    number: number;
    title: string;
  };
  planSummary?: string;
  planApproach?: string;
  tasks: Array<{
    number: number;
    title: string;
    status: string;
    type: string;
  }>;
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
  /** Active issues for the issues ribbon */
  issues: KanbanIssue[];
  workers: WorkerCounts;
  lastUpdated: Date;
}

/**
 * Fetch Kanban data from the database using BoardQueryService
 */
async function fetchKanbanData(dbPath: string, projectId: string): Promise<KanbanData | null> {
  const sourceProvider = new DbSourceProvider();
  const source = sourceProvider.getOrCreate({ connectionString: dbPath });
  const client = source.createClient(projectId);
  const workerQueueDb = new GlobalDbWorkerQueueDb();

  try {
    // Get project first (projects is a global repo on source)
    const project = await source.projects.findById(projectId);
    if (!project) {
      return null;
    }

    // Create BoardQueryService with DbClient and worker queue
    const boardService = new BoardQueryService(client, workerQueueDb);

    const boardData = boardService.getBoardData();

    // Map BoardTask to KanbanTask for backward compatibility
    const columns = boardData.columns.map((col) => ({
      status: col.status,
      label: col.label,
      tasks: col.tasks.map((t) => ({
        id: t.id,
        issueNumber: t.issueNumber,
        taskNumber: t.taskNumber,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        implementationPlan: t.implementationPlan,
        type: t.type,
        status: t.status,
        branchName: t.branchName,
        worktreePath: t.worktreePath,
        prUrl: t.prUrl,
        prNumber: t.prNumber,
        prStatus: t.prStatus,
        githubIssueNumber: t.githubIssueNumber,
        githubUrl: t.githubUrl,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        abandonedAt: t.abandonedAt,
        submittedForReviewAt: t.submittedForReviewAt,
        createdAt: t.createdAt,
      })),
    }));

    // Get active issues for the ribbon
    const issuesWithTasks = boardService.getActiveIssuesWithTasks();
    const issues: KanbanIssue[] = issuesWithTasks.map(
      ({ issue, plan, tasks, milestone }): KanbanIssue => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        description: issue.description,
        acceptanceCriteria: issue.acceptanceCriteria,
        type: issue.type,
        status: issue.status,
        priority: issue.priority,
        milestone,
        planSummary: plan?.summary,
        planApproach: plan?.approach,
        tasks: tasks.map((t) => ({
          number: t.number,
          title: t.title,
          status: t.status,
          type: t.type,
        })),
      })
    );

    return {
      project,
      columns,
      issues,
      workers: boardData.workers,
      lastUpdated: boardData.lastUpdated,
    };
  } finally {
    source.close();
    workerQueueDb.close();
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

/**
 * React hook for multi-project Kanban data with project switching
 *
 * Manages multiple projects and allows switching between them.
 * Data is only fetched for the currently selected project.
 */
export function useMultiProjectKanbanData(
  projects: ProjectInfo[],
  intervalMs: number = 3000
): {
  data: KanbanData | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
  currentProjectIndex: number;
  setCurrentProjectIndex: (index: number) => void;
  projectCount: number;
} {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentProject = projects[currentIndex];

  // Ensure index is valid if projects array changes
  useEffect(() => {
    if (currentIndex >= projects.length && projects.length > 0) {
      setCurrentIndex(0);
    }
  }, [currentIndex, projects.length]);

  // Use the single-project hook for the current project
  const { data, error, loading, refresh } = useKanbanData(
    currentProject?.sourceInfo.connectionString ?? "",
    currentProject?.projectId ?? "",
    intervalMs
  );

  const handleSetIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < projects.length) {
        setCurrentIndex(index);
      }
    },
    [projects.length]
  );

  return {
    data,
    error,
    loading,
    refresh,
    currentProjectIndex: currentIndex,
    setCurrentProjectIndex: handleSetIndex,
    projectCount: projects.length,
  };
}

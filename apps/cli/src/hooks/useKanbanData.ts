import { useState, useEffect, useCallback, useRef } from "react";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import {
  DbSourceProvider,
  BoardQueryService,
  NoOpProjectManagementClient,
  ProjectManagementService,
  TaskService,
  IssueService,
  type Project,
  type TaskStatus,
  type BoardTask,
  type ProjectInfo,
  type IssueStatus,
} from "@dev-workflow/tracking";

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
 * Worker assignment for display
 */
export interface KanbanWorkerAssignment {
  taskId: string;
  workerId: string;
  workerName: string | null;
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
  /** Map of taskId to worker assignment */
  workerAssignments: Map<string, KanbanWorkerAssignment>;
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

    // Get worker assignments
    const workerAssignmentsMap = boardService.getWorkerAssignments();
    const workerAssignments = new Map<string, KanbanWorkerAssignment>();
    workerAssignmentsMap.forEach((assignment, taskId) => {
      workerAssignments.set(taskId, {
        taskId: assignment.taskId,
        workerId: assignment.workerId,
        workerName: assignment.workerName,
      });
    });

    return {
      project,
      columns,
      issues,
      workers: boardData.workers,
      workerAssignments,
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

/**
 * Action result with success/error state
 */
export interface ActionResult {
  success: boolean;
  message: string;
}

/**
 * Available actions for the board
 */
export interface KanbanActions {
  // Task actions - proper business methods
  moveToBacklog: (taskId: string) => Promise<ActionResult>;
  moveToReady: (taskId: string) => Promise<ActionResult>;
  start: (taskId: string) => Promise<ActionResult>;
  submitForReview: (taskId: string) => Promise<ActionResult>;
  complete: (taskId: string) => Promise<ActionResult>;
  abandonTask: (taskId: string) => Promise<ActionResult>;

  // Issue actions
  updateIssueStatus: (issueId: string, status: IssueStatus) => Promise<ActionResult>;
  closeIssue: (issueId: string) => Promise<ActionResult>;
  activateIssueTasks: (issueId: string) => Promise<ActionResult>;
}

/**
 * React hook for Kanban board actions
 *
 * Provides action handlers that use core services directly.
 * Services are created lazily and reused across calls.
 */
export function useKanbanActions(
  dbPath: string,
  projectId: string,
  onActionComplete?: () => void
): KanbanActions {
  // Keep services alive between renders
  const servicesRef = useRef<{
    sourceProvider: DbSourceProvider;
    taskService: TaskService;
    issueService: IssueService;
  } | null>(null);

  // Lazily initialize services
  const getServices = useCallback(() => {
    if (!servicesRef.current && dbPath && projectId) {
      const sourceProvider = new DbSourceProvider();
      const source = sourceProvider.getOrCreate({ connectionString: dbPath });
      const client = source.createClient(projectId);

      // Use NoOp client for CLI (no GitHub sync from board)
      const projectManagement = new ProjectManagementService(new NoOpProjectManagementClient());

      const taskService = new TaskService(client, projectManagement, null);
      const issueService = new IssueService(client, taskService, projectManagement);

      servicesRef.current = { sourceProvider, taskService, issueService };
    }
    return servicesRef.current;
  }, [dbPath, projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (servicesRef.current) {
        servicesRef.current.sourceProvider.closeAll();
        servicesRef.current = null;
      }
    };
  }, []);

  const moveToBacklog = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.moveToBacklog(taskId);
        onActionComplete?.();
        return { success: true, message: "Task moved to backlog" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const moveToReady = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.moveToReady(taskId);
        onActionComplete?.();
        return { success: true, message: "Task moved to ready" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const start = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.start(taskId);
        onActionComplete?.();
        return { success: true, message: "Task started" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const submitForReview = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.submitForReview(taskId);
        onActionComplete?.();
        return { success: true, message: "Task submitted for review" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const complete = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.complete(taskId);
        onActionComplete?.();
        return { success: true, message: "Task completed" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const abandonTask = useCallback(
    async (taskId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.taskService.abandonTask(taskId);
        onActionComplete?.();
        return { success: true, message: "Task abandoned" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const updateIssueStatus = useCallback(
    async (issueId: string, status: IssueStatus): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.issueService.updateStatus(issueId, status);
        onActionComplete?.();
        return { success: true, message: `Issue status updated to ${status}` };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const closeIssue = useCallback(
    async (issueId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }
        await services.issueService.closeIssue(issueId, true); // force=true to abandon incomplete tasks
        onActionComplete?.();
        return { success: true, message: "Issue closed" };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  const activateIssueTasks = useCallback(
    async (issueId: string): Promise<ActionResult> => {
      try {
        const services = getServices();
        if (!services) {
          return { success: false, message: "Services not initialized" };
        }

        // Get all tasks for the issue and move BACKLOG ones to READY
        const tasks = services.taskService.getIncompleteTasksForIssue(issueId);
        let activated = 0;
        for (const task of tasks) {
          if (task.status === "BACKLOG") {
            await services.taskService.moveToReady(task.id);
            activated++;
          }
        }

        onActionComplete?.();
        return { success: true, message: `${activated} task(s) moved to Ready` };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [getServices, onActionComplete]
  );

  return {
    moveToBacklog,
    moveToReady,
    start,
    submitForReview,
    complete,
    abandonTask,
    updateIssueStatus,
    closeIssue,
    activateIssueTasks,
  };
}

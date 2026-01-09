import { NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
import {
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  DataSourceFactory,
  getGlobalDatabasePath,
  type SqliteDataSource,
  type WorkerWithHealth,
  type DispatchQueueEntryWithHealth,
} from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface DispatchQueueEntryWithDetails extends DispatchQueueEntryWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskTitle?: string;
  totalTasks?: number;
}

interface WorkerWithTaskDetails extends WorkerWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskStartedAt?: string;
  totalTasks?: number;
}

interface WorkerData {
  workers: WorkerWithTaskDetails[];
  queue: DispatchQueueEntryWithDetails[];
  stats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

interface TaskDetails {
  taskNumber: number;
  issueNumber: number;
  taskTitle: string;
  taskStartedAt: string | null;
  totalTasks: number;
}

async function lookupTaskDetails(
  taskId: string,
  projects: { id: string; slug: string }[],
  registry: DataSourceRegistry
): Promise<TaskDetails | null> {
  for (const project of projects) {
    try {
      const context = await WebDIContext.createFromProjectInfo(project, registry);
      const task = context.taskRepository.findById(taskId);

      if (task) {
        const plan = context.planRepository.findById(task.planId);
        if (plan) {
          const issue = context.issueRepository.findById(plan.issueId);
          if (issue) {
            // Get total task count for the plan
            const allTasks = context.taskRepository.findByPlanId(plan.id);
            return {
              taskNumber: task.number,
              issueNumber: issue.number,
              taskTitle: task.title,
              taskStartedAt: task.startedAt ?? null,
              totalTasks: allTasks.length,
            };
          }
        }
      }
    } catch {
      // Continue searching
    }
  }
  return null;
}

export async function GET() {
  try {
    // Workers are GLOBAL - connect directly to the global database
    // This ensures workers show up even if no projects are configured
    const dbPath = getGlobalDatabasePath();
    const dataSource = (await DataSourceFactory.createSqlite(dbPath)) as SqliteDataSource;
    const db = dataSource.getDb();

    const workerRepository = new SqliteWorkerRepository(db);
    const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

    const workers = workerRepository.findAllWithHealth();
    const queueEntries = dispatchQueueRepository.findAllWithHealth();
    const stats = dispatchQueueRepository.getQueueStats();

    // Try to get project info for enrichment, but don't fail if unavailable
    let projects: { id: string; slug: string }[] = [];
    let registry: DataSourceRegistry | null = null;
    try {
      registry = new DataSourceRegistry();
      const result = await registry.getSourcesWithProjects();
      projects = result.projects;
    } catch {
      // Projects unavailable, continue without enrichment
    }

    // Enrich queue entries with task details
    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];
    for (const entry of queueEntries) {
      const details = registry ? await lookupTaskDetails(entry.taskId, projects, registry) : null;
      enrichedQueue.push({
        ...entry,
        taskNumber: details?.taskNumber,
        issueNumber: details?.issueNumber,
        taskTitle: details?.taskTitle,
        totalTasks: details?.totalTasks,
      });
    }

    // Enrich workers with task details
    const enrichedWorkers: WorkerWithTaskDetails[] = [];
    for (const worker of workers) {
      if (worker.currentTaskId && registry) {
        const details = await lookupTaskDetails(worker.currentTaskId, projects, registry);
        enrichedWorkers.push({
          ...worker,
          taskNumber: details?.taskNumber,
          issueNumber: details?.issueNumber,
          taskStartedAt: details?.taskStartedAt ?? undefined,
          totalTasks: details?.totalTasks,
        });
      } else {
        enrichedWorkers.push(worker);
      }
    }

    const workerData: WorkerData = {
      workers: enrichedWorkers,
      queue: enrichedQueue,
      stats,
    };

    return NextResponse.json(workerData);
  } catch (error) {
    console.error("Error fetching worker data:", error);
    return NextResponse.json({ error: "Failed to fetch worker data" }, { status: 500 });
  }
}

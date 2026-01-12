import { NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import {
  GlobalDbWorkerQueueDb,
  type WorkerWithHealth,
  type QueueEntryWithHealth,
} from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface DispatchQueueEntryWithDetails extends QueueEntryWithHealth {
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
  projects: { projectId: string; slug: string }[],
  sourceProvider: DbSourceProvider
): Promise<TaskDetails | null> {
  const resolver = new ProjectsResolver();
  for (const project of projects) {
    try {
      const projectInfo = await resolver.getProjectBySlug(project.slug);
      const context = await WebDIContext.createFromProjectInfo(projectInfo, sourceProvider);
      // Use services for lookups
      const task = context.taskService.findById(taskId);

      if (task) {
        const plan = context.planService.findById(task.planId);
        if (plan) {
          const issue = context.issueService.findById(plan.issueId);
          if (issue) {
            // Get total task count for the plan
            const allTasks = context.taskService.findByPlanId(plan.id);
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
  const sourceProvider = new DbSourceProvider();
  // Worker queue uses separate database (~/.track/worker-queue.db)
  const workerQueueDb = new GlobalDbWorkerQueueDb();
  try {
    // Get workers and queue from the worker queue database
    const workers = workerQueueDb.findAllWorkersWithHealth();
    const queueEntries = workerQueueDb.findAllEntriesWithHealth();
    const stats = workerQueueDb.getQueueStats();

    // Try to get project info for enrichment, but don't fail if unavailable
    let projects: { projectId: string; slug: string }[] = [];
    try {
      const resolver = new ProjectsResolver();
      const sources = await resolver.getAllSources();
      projects = sources.flatMap((s) => s.projects);
    } catch {
      // Projects unavailable, continue without enrichment
    }

    // Enrich queue entries with task details
    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];
    for (const entry of queueEntries) {
      const details =
        projects.length > 0
          ? await lookupTaskDetails(entry.taskId, projects, sourceProvider)
          : null;
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
      if (worker.currentTaskId && projects.length > 0) {
        const details = await lookupTaskDetails(worker.currentTaskId, projects, sourceProvider);
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
  } finally {
    workerQueueDb.close();
    sourceProvider.closeAll();
  }
}

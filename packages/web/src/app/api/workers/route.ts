import { NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
import {
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  type SqliteDataSource,
  type WorkerWithHealth,
  type DispatchQueueEntryWithHealth,
} from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface DispatchQueueEntryWithDetails extends DispatchQueueEntryWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskTitle?: string;
}

interface WorkerData {
  workers: WorkerWithHealth[];
  queue: DispatchQueueEntryWithDetails[];
  stats: {
    total: number;
    unclaimed: number;
    claimed: number;
    stale: number;
  };
}

export async function GET() {
  try {
    const registry = new DataSourceRegistry();
    const { sources, projects } = await registry.getSourcesWithProjects();

    if (sources.length === 0 || projects.length === 0) {
      const emptyData: WorkerData = {
        workers: [],
        queue: [],
        stats: { total: 0, unclaimed: 0, claimed: 0, stale: 0 },
      };
      return NextResponse.json(emptyData);
    }

    // Use first project to get database access
    const dataSource = (await registry.getDataSource(projects[0]!.slug)) as SqliteDataSource;
    const db = dataSource.getDb();

    const workerRepository = new SqliteWorkerRepository(db);
    const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

    const workers = workerRepository.findAllWithHealth();
    const queueEntries = dispatchQueueRepository.findAllWithHealth();
    const stats = dispatchQueueRepository.getQueueStats();

    // Enrich queue entries with task details
    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];

    for (const entry of queueEntries) {
      let taskNumber: number | undefined;
      let issueNumber: number | undefined;
      let taskTitle: string | undefined;

      for (const project of projects) {
        try {
          const context = await WebDIContext.createFromProjectInfo(project, registry);
          const task = context.taskRepository.findById(entry.taskId);

          if (task) {
            taskNumber = task.number;
            taskTitle = task.title;

            const plan = context.planRepository.findById(task.planId);
            if (plan) {
              const issue = context.issueRepository.findById(plan.issueId);
              if (issue) {
                issueNumber = issue.number;
              }
            }
            break;
          }
        } catch {
          // Continue searching
        }
      }

      enrichedQueue.push({
        ...entry,
        taskNumber,
        issueNumber,
        taskTitle,
      });
    }

    const workerData: WorkerData = {
      workers,
      queue: enrichedQueue,
      stats,
    };

    return NextResponse.json(workerData);
  } catch (error) {
    console.error("Error fetching worker data:", error);
    return NextResponse.json({ error: "Failed to fetch worker data" }, { status: 500 });
  }
}

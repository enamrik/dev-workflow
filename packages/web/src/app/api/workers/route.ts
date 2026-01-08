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

    // Enrich queue entries with task details (optional - won't fail if no projects)
    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];

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

    for (const entry of queueEntries) {
      let taskNumber: number | undefined;
      let issueNumber: number | undefined;
      let taskTitle: string | undefined;

      // Try to enrich with task details from projects
      for (const project of projects) {
        try {
          const context = await WebDIContext.createFromProjectInfo(project, registry!);
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

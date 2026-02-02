/**
 * getWorkerData - Get workers and queue with enriched task details
 */

import { Effect } from "@dev-workflow/effect";
import { ProjectsResolver, DbSourceProvider } from "@dev-workflow/tracking";
import type { QueueEntryWithHealth } from "@dev-workflow/dispatch/worker-queue-db.js";
import type { WorkerWithHealth } from "@dev-workflow/dispatch/worker.js";
import { WorkerQueueDbTag } from "../di/service-tags";
import { getDbClient } from "./helpers";

// =============================================================================
// Types
// =============================================================================

export interface DispatchQueueEntryWithDetails extends QueueEntryWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskTitle?: string;
  totalTasks?: number;
}

export interface WorkerWithTaskDetails extends WorkerWithHealth {
  taskNumber?: number;
  issueNumber?: number;
  taskStartedAt?: string;
  totalTasks?: number;
}

export interface WorkerDataResult {
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

// =============================================================================
// Operation
// =============================================================================

export function getWorkerData() {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;
    const workerQueueDb = yield* WorkerQueueDbTag;

    return yield* Effect.promise(async (): Promise<WorkerDataResult> => {
      const workers = workerQueueDb.findAllWorkersWithHealth();
      const queueEntries = workerQueueDb.findAllEntriesWithHealth();
      const stats = workerQueueDb.getQueueStats();

      let projects: { projectId: string; slug: string }[] = [];
      try {
        const sources = await projectsResolver.getAllSources();
        projects = sources.flatMap((s) => s.projects);
      } catch {
        // Projects unavailable, continue without enrichment
      }

      const enrichedQueue: DispatchQueueEntryWithDetails[] = [];
      for (const entry of queueEntries) {
        const details =
          projects.length > 0
            ? await lookupTaskDetails(entry.taskId, projects, projectsResolver, sourceProvider)
            : null;
        enrichedQueue.push({
          ...entry,
          taskNumber: details?.taskNumber,
          issueNumber: details?.issueNumber,
          taskTitle: details?.taskTitle,
          totalTasks: details?.totalTasks,
        });
      }

      const enrichedWorkers: WorkerWithTaskDetails[] = [];
      for (const worker of workers) {
        if (worker.currentTaskId && projects.length > 0) {
          const details = await lookupTaskDetails(
            worker.currentTaskId,
            projects,
            projectsResolver,
            sourceProvider
          );
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

      return { workers: enrichedWorkers, queue: enrichedQueue, stats };
    });
  });
}

// =============================================================================
// Helpers
// =============================================================================

async function lookupTaskDetails(
  taskId: string,
  projects: { projectId: string; slug: string }[],
  projectsResolver: ProjectsResolver,
  sourceProvider: DbSourceProvider
): Promise<TaskDetails | null> {
  for (const project of projects) {
    try {
      const projectInfo = await projectsResolver.getProjectBySlug(project.slug);
      const db = await getDbClient(projectInfo, sourceProvider);
      const task = await Effect.runPromise(db.tasks.findById(taskId));

      if (task) {
        const plan = await db.plans.findById(task.planId);
        if (plan) {
          const issue = await Effect.runPromise(db.issues.findById(plan.issueId));
          if (issue) {
            const allTasks = await Effect.runPromise(db.tasks.findByPlanId(plan.id));
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

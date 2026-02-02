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

// =============================================================================
// Operation
// =============================================================================

export function getWorkerData() {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;
    const workerQueueDb = yield* WorkerQueueDbTag;

    const workers = workerQueueDb.findAllWorkersWithHealth();
    const queueEntries = workerQueueDb.findAllEntriesWithHealth();
    const stats = workerQueueDb.getQueueStats();

    let projects: { projectId: string; slug: string }[] = [];
    try {
      const sources = yield* projectsResolver.getAllSources();
      projects = sources.flatMap((s) => s.projects);
    } catch {
      // Projects unavailable, continue without enrichment
    }

    const enrichedQueue: DispatchQueueEntryWithDetails[] = [];
    for (const entry of queueEntries) {
      const details =
        projects.length > 0
          ? yield* lookupTaskDetails(entry.taskId, projects, projectsResolver, sourceProvider)
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
        const details = yield* lookupTaskDetails(
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

    return { workers: enrichedWorkers, queue: enrichedQueue, stats } satisfies WorkerDataResult;
  });
}

// =============================================================================
// Helpers
// =============================================================================

function lookupTaskDetails(
  taskId: string,
  projects: { projectId: string; slug: string }[],
  projectsResolver: ProjectsResolver,
  sourceProvider: DbSourceProvider
) {
  return Effect.gen(function* () {
    for (const project of projects) {
      try {
        const projectInfo = yield* projectsResolver.getProjectBySlug(project.slug);
        const db = yield* Effect.promise(() => getDbClient(projectInfo, sourceProvider));
        const task = yield* db.tasks.findById(taskId);

        if (task) {
          const plan = yield* db.plans.findById(task.planId);
          if (plan) {
            const issue = yield* db.issues.findById(plan.issueId);
            if (issue) {
              const allTasks = yield* db.tasks.findByPlanId(plan.id);
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
  });
}

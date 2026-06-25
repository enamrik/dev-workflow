/**
 * listAllTasksForBoard - Get active issues with tasks for kanban board view
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  BoardQueryService,
  Task,
  type Plan,
  type Issue,
  type WorkerTaskAssignment,
} from "@dev-workflow/tracking";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import { WorkerQueueDbTag } from "../service-tags.js";
import { getDbClient, filterProjects } from "./helpers.js";

// =============================================================================
// Schema
// =============================================================================

export const ListAllTasksForBoardSchema = z.object({
  projectFilter: z.string().optional(),
});
export type ListAllTasksForBoardInput = z.infer<typeof ListAllTasksForBoardSchema>;

// =============================================================================
// Types
// =============================================================================

export interface TaskWithWorker extends Task {
  workerId?: string;
  workerName?: string;
}

export interface IssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: TaskWithWorker[];
  milestoneNumber?: number;
  milestoneTitle?: string;
  projectName?: string;
  projectSlug?: string;
}

export interface CompletedTaskWithContext extends Task {
  projectId: string;
  projectName: string;
  projectSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  issueStatus: string;
}

export interface BoardTasksResult {
  issuesWithTasks: IssueWithTasks[];
  completedTasks: CompletedTaskWithContext[];
}

// =============================================================================
// Operation
// =============================================================================

export function listAllTasksForBoard(input: ListAllTasksForBoardInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;
    const workerQueueDb = yield* WorkerQueueDbTag;

    const validated = validateInput(ListAllTasksForBoardSchema, input);
    const projects = filterProjects(
      yield* projectsResolver.getAllProjects(),
      validated.projectFilter
    );

    const workerAssignments = getWorkerAssignments(workerQueueDb);
    const issuesWithTasks: IssueWithTasks[] = [];
    const completedTasks: CompletedTaskWithContext[] = [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffDateStr = cutoffDate.toISOString();

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const boardService = new BoardQueryService(db);
        const boardData = yield* boardService.getActiveIssuesWithTasks();

        for (const { issue, plan, tasks, milestone } of boardData) {
          const tasksWithWorker: TaskWithWorker[] = tasks.map((task) => {
            const workerInfo = workerAssignments.get(task.id);
            if (workerInfo) {
              return Object.assign(Task.from(task), {
                workerId: workerInfo.workerId,
                workerName: workerInfo.workerName ?? undefined,
              });
            }
            return task;
          });

          issuesWithTasks.push({
            issue,
            plan,
            tasks: tasksWithWorker,
            milestoneNumber: milestone?.number,
            milestoneTitle: milestone?.title,
            projectName: project.name,
            projectSlug: project.slug,
          });

          for (const task of tasks) {
            if (task.status !== "COMPLETED" && task.status !== "ABANDONED") continue;
            const completionDate = task.completedAt ?? task.abandonedAt;
            if (!completionDate || completionDate < cutoffDateStr) continue;

            completedTasks.push(
              Object.assign(Task.from(task), {
                projectId: issue.projectId,
                projectName: project.name,
                projectSlug: project.slug,
                issueNumber: issue.number,
                issueTitle: issue.title,
                issueType: issue.type,
                issueStatus: issue.status,
              })
            );
          }
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    completedTasks.sort((a, b) => {
      const dateA = a.completedAt ?? a.abandonedAt ?? "";
      const dateB = b.completedAt ?? b.abandonedAt ?? "";
      return dateB.localeCompare(dateA);
    });

    return {
      issuesWithTasks,
      completedTasks: completedTasks.slice(0, 20),
    };
  });
}

// =============================================================================
// Helpers
// =============================================================================

function getWorkerAssignments(workerQueueDb: WorkerQueueDb): Map<string, WorkerTaskAssignment> {
  const assignments = new Map<string, WorkerTaskAssignment>();
  try {
    const entries = workerQueueDb.findAllEntriesWithHealth();
    for (const entry of entries) {
      if (entry.workerId && entry.status === "WORKING") {
        assignments.set(entry.taskId, {
          taskId: entry.taskId,
          workerId: entry.workerId,
          workerName: entry.workerName ?? null,
        });
      }
    }
  } catch {
    // Return empty map on failure
  }
  return assignments;
}

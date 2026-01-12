import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import type { Issue, Plan, Task } from "@dev-workflow/core";
import { GlobalDbWorkerQueueDb, type WorkerTaskAssignment } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface TaskWithWorker extends Task {
  workerId?: string;
  workerName?: string;
}

interface IssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: TaskWithWorker[];
  milestoneNumber?: number;
  milestoneTitle?: string;
  projectName?: string;
  projectSlug?: string;
}

interface CompletedTaskWithContext extends Task {
  projectId: string;
  projectName: string;
  projectSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  issueStatus: string;
}

/**
 * Get worker assignments from worker queue database
 *
 * Queries the separate worker queue database (~/.track/worker-queue.db) to find
 * which workers are currently working on which tasks.
 */
function getWorkerAssignments(): Map<string, WorkerTaskAssignment> {
  const assignments = new Map<string, WorkerTaskAssignment>();
  let workerQueueDb: GlobalDbWorkerQueueDb | null = null;

  try {
    workerQueueDb = new GlobalDbWorkerQueueDb();
    const entries = workerQueueDb.findAllEntriesWithHealth();

    for (const entry of entries) {
      // Only include entries where a worker is actively working
      if (entry.workerId && entry.status === "WORKING") {
        assignments.set(entry.taskId, {
          taskId: entry.taskId,
          workerId: entry.workerId,
          workerName: entry.workerName ?? null,
        });
      }
    }

    return assignments;
  } catch {
    // Continue without worker info if worker queue db is inaccessible
    return assignments;
  } finally {
    workerQueueDb?.close();
  }
}

export async function GET(request: NextRequest) {
  const sourceProvider = new DbSourceProvider();
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;

    const resolver = new ProjectsResolver();

    // Get all projects and filter by project ID or slug
    let projects = await resolver.getAllProjects();
    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    // Get worker assignments from worker queue database
    const workerAssignments = getWorkerAssignments();

    const issuesWithTasks: IssueWithTasks[] = [];
    const completedTasks: CompletedTaskWithContext[] = [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffDateStr = cutoffDate.toISOString();

    for (const project of projects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, sourceProvider);

        // Use BoardQueryService to get active issues (excludes CLOSED at DB level)
        // Closed issue tasks are included via completedTasks feed for Done column
        const boardData = context.boardQueryService.getActiveIssuesWithTasks();

        for (const { issue, plan, tasks, milestone } of boardData) {
          // Enrich tasks with worker info
          const tasksWithWorker: TaskWithWorker[] = tasks.map((task) => {
            const workerInfo = workerAssignments.get(task.id);
            if (workerInfo) {
              return {
                ...task,
                workerId: workerInfo.workerId,
                workerName: workerInfo.workerName ?? undefined,
              };
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

          // Collect completed tasks from last 7 days
          for (const task of tasks) {
            if (task.status !== "COMPLETED" && task.status !== "ABANDONED") continue;

            const completionDate = task.completedAt ?? task.abandonedAt;
            if (!completionDate || completionDate < cutoffDateStr) continue;

            completedTasks.push({
              ...task,
              projectId: issue.projectId,
              projectName: project.name,
              projectSlug: project.slug,
              issueNumber: issue.number,
              issueTitle: issue.title,
              issueType: issue.type,
              issueStatus: issue.status,
            });
          }
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort completed tasks by completion date descending, limit to 20
    completedTasks.sort((a, b) => {
      const dateA = a.completedAt ?? a.abandonedAt ?? "";
      const dateB = b.completedAt ?? b.abandonedAt ?? "";
      return dateB.localeCompare(dateA);
    });

    return NextResponse.json({
      issuesWithTasks,
      completedTasks: completedTasks.slice(0, 20),
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

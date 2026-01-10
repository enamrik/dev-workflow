import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
import type { Issue, Plan, Task } from "@dev-workflow/core";
import {
  SqliteDispatchQueueRepository,
  DataSourceFactory,
  getGlobalDatabasePath,
  type SqliteDataSource,
} from "@dev-workflow/core";

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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;
    const sourceFilter = searchParams.get("source") ?? undefined;

    const registry = new DataSourceRegistry();
    const filteredProjects = await registry.getFilteredProjects({
      project: projectFilter,
      source: sourceFilter,
    });

    // Fetch dispatch queue data from global database for worker info
    // Build a map of taskId -> { workerId, workerName } for tasks with WORKING workers
    const workerByTaskId = new Map<string, { workerId: string; workerName: string | null }>();
    try {
      const dbPath = getGlobalDatabasePath();
      const dataSource = (await DataSourceFactory.createSqlite(dbPath)) as SqliteDataSource;
      const db = dataSource.getDb();
      const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);
      const queueEntries = dispatchQueueRepository.findAllWithHealth();

      for (const entry of queueEntries) {
        if (entry.workerId && entry.status === "WORKING") {
          workerByTaskId.set(entry.taskId, {
            workerId: entry.workerId,
            workerName: entry.workerName,
          });
        }
      }
    } catch {
      // Continue without worker info if global db is inaccessible
    }

    const issuesWithTasks: IssueWithTasks[] = [];
    const completedTasks: CompletedTaskWithContext[] = [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffDateStr = cutoffDate.toISOString();

    for (const project of filteredProjects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, registry);
        const issues = context.issueRepository.findMany({});

        for (const issue of issues) {
          const plan = context.planRepository.findByIssueId(issue.id);
          const tasks = plan ? context.taskRepository.findByPlanId(plan.id) : [];

          // For kanban board: skip closed issues
          if (issue.status !== "CLOSED") {
            let milestoneNumber: number | undefined;
            let milestoneTitle: string | undefined;
            if (issue.milestoneId) {
              const milestone = context.milestoneRepository.findById(issue.milestoneId);
              if (milestone) {
                milestoneNumber = milestone.number;
                milestoneTitle = milestone.title;
              }
            }

            // Enrich tasks with worker info when worker is in WORKING state
            // This includes both IN_PROGRESS and PR_REVIEW tasks since workers
            // continue working through the PR lifecycle
            const tasksWithWorker: TaskWithWorker[] = tasks.map((task) => {
              const workerInfo = workerByTaskId.get(task.id);
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
              milestoneNumber,
              milestoneTitle,
              projectName: project.name,
              projectSlug: project.slug,
            });
          }

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
  }
}

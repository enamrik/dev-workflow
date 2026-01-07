import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
import type { Issue, Plan, Task } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface IssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
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
    const { projects } = await registry.getSourcesWithProjects();

    // Filter projects
    let filteredProjects = projects;
    if (projectFilter) {
      filteredProjects = filteredProjects.filter((p) => p.id === projectFilter);
    }
    if (sourceFilter) {
      filteredProjects = filteredProjects.filter((p) => p.sourceId === sourceFilter);
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

            issuesWithTasks.push({
              issue,
              plan,
              tasks,
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

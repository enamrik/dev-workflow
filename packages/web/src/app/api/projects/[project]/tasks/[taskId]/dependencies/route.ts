import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";

interface RouteParams {
  params: Promise<{
    project: string;
    taskId: string;
  }>;
}

/**
 * GET /api/projects/[project]/tasks/[taskId]/dependencies
 *
 * Returns the dependency tasks for a task (the tasks this task depends on).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { taskId } = await params;

    // Search for task across all projects
    const resolver = new ProjectsResolver();
    const projects = await resolver.getAllProjects();

    for (const project of projects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, sourceProvider);
        const task = context.db.tasks.findById(taskId);

        if (task) {
          if (!task.dependsOn || task.dependsOn.length === 0) {
            return NextResponse.json([]);
          }
          const dependencies = context.db.tasks.findByIds(task.dependsOn);
          // Enrich dependencies with issue number for #issue.task display format
          const enrichedDependencies = dependencies.map((dep) => {
            const depPlan = context.db.plans.findById(dep.planId);
            const depIssue = depPlan ? context.db.issues.findById(depPlan.issueId) : null;
            return {
              ...dep,
              issueNumber: depIssue?.number ?? null,
            };
          });
          return NextResponse.json(enrichedDependencies);
        }
      } catch {
        // Continue searching
      }
    }

    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  } catch (error) {
    console.error("Error fetching task dependencies:", error);
    return NextResponse.json({ error: "Failed to fetch task dependencies" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

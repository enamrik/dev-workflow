import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";

interface RouteParams {
  params: Promise<{
    project: string;
    taskId: string;
  }>;
}

/**
 * GET /api/projects/[project]/tasks/[taskId]/logs
 *
 * Returns the execution logs for a task.
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
          const logs = context.db.tasks.getExecutionLogs(taskId);
          return NextResponse.json(logs);
        }
      } catch {
        // Continue searching
      }
    }

    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  } catch (error) {
    console.error("Error fetching task execution logs:", error);
    return NextResponse.json({ error: "Failed to fetch task execution logs" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

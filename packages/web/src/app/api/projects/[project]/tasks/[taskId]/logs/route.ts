import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";

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
  try {
    const { taskId } = await params;

    // Search for task across all projects
    const registry = new DataSourceRegistry();
    const { projects } = await registry.getSourcesWithProjects();

    for (const project of projects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, registry);
        const task = context.taskRepository.findById(taskId);

        if (task) {
          const logs = context.taskRepository.getExecutionLogs(taskId);
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
  }
}

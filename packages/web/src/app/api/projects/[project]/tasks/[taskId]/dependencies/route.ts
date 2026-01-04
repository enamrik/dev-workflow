import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

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
  try {
    const { taskId } = await params;

    const service = getMultiProjectService();

    // First verify the task exists
    const task = await service.getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const dependencies = await service.getTaskDependencies(taskId);

    return NextResponse.json(dependencies);
  } catch (error) {
    console.error("Error fetching task dependencies:", error);
    return NextResponse.json({ error: "Failed to fetch task dependencies" }, { status: 500 });
  }
}

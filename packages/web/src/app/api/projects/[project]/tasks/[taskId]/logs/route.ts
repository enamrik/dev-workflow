import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

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

    const service = getMultiProjectService();

    // First verify the task exists
    const task = await service.getTask(taskId);
    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    const logs = await service.getTaskExecutionLogs(taskId);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching task execution logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch task execution logs" },
      { status: 500 }
    );
  }
}

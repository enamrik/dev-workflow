import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

interface RouteParams {
  params: Promise<{
    project: string;
    taskId: string;
  }>;
}

/**
 * GET /api/projects/[project]/tasks/[taskId]/history
 *
 * Returns the status change history for a task.
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

    const history = await service.getTaskStatusHistory(taskId);

    return NextResponse.json(history);
  } catch (error) {
    console.error("Error fetching task status history:", error);
    return NextResponse.json(
      { error: "Failed to fetch task status history" },
      { status: 500 }
    );
  }
}

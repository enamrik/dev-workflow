import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import { isTerminal } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface AbandonRequest {
  projectSlug: string;
  reason?: string;
}

/**
 * POST /api/tasks/[taskId]/abandon
 *
 * Abandons a task. This is an irreversible action that:
 * - Transitions the task to ABANDONED status
 * - Closes any linked external issues
 * - Cleans up worktree and branch if present
 *
 * Request body:
 * {
 *   projectSlug: string,
 *   reason?: string
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { taskId } = await params;
    const body = (await request.json()) as AbandonRequest;
    const { projectSlug, reason } = body;

    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    // Create context for the project
    const resolver = new ProjectsResolver();
    const context = await WebDIContext.create(projectSlug, resolver, sourceProvider);

    // Find the task
    const task = context.db.tasks.findById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if already terminal
    if (isTerminal(task)) {
      return NextResponse.json(
        {
          error: `Task is already in terminal state: ${task.status}`,
          currentStatus: task.status,
        },
        { status: 400 }
      );
    }

    // Abandon the task via service
    const result = await context.taskService.abandonTask(
      taskId,
      reason ?? "User abandoned via UI",
      "web-ui"
    );

    return NextResponse.json({
      success: true,
      task: {
        id: result.task.id,
        number: result.task.number,
        title: result.task.title,
        status: "ABANDONED",
        previousStatus: task.status,
      },
      cleanup: {
        externalIssueClosed: result.externalIssueClosed,
        worktreeCleaned: result.worktreeCleaned,
        branchDeleted: result.branchDeleted,
      },
    });
  } catch (error) {
    console.error("Error abandoning task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to abandon task" },
      { status: 500 }
    );
  } finally {
    sourceProvider.closeAll();
  }
}

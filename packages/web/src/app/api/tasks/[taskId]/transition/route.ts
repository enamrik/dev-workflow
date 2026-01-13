import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import { isValidStatusTransition, isIssueInPlanning, type TaskStatus } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface TransitionRequest {
  targetStatus: TaskStatus;
  projectSlug: string;
}

/**
 * POST /api/tasks/[taskId]/transition
 *
 * Transitions a task to a new status. Validates that the transition is allowed
 * according to the task state machine.
 *
 * Supported transitions from UI:
 * - PLANNED → BACKLOG: Activates the task for work
 * - BACKLOG → READY: Marks task as next up
 * - IN_PROGRESS → PR_REVIEW: Submits task for review (requires PR to exist)
 *
 * Request body:
 * {
 *   targetStatus: "BACKLOG" | "READY" | "PR_REVIEW",
 *   projectSlug: string
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { taskId } = await params;
    const body = (await request.json()) as TransitionRequest;
    const { targetStatus, projectSlug } = body;

    if (!targetStatus || !projectSlug) {
      return NextResponse.json(
        { error: "targetStatus and projectSlug are required" },
        { status: 400 }
      );
    }

    // Create context for the project
    const resolver = new ProjectsResolver();
    const context = await WebDIContext.create(projectSlug, resolver, sourceProvider);

    // Find the task
    const task = context.db.tasks.findById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Validate the transition is allowed
    if (!isValidStatusTransition(task.status, targetStatus)) {
      return NextResponse.json(
        {
          error: `Invalid transition from ${task.status} to ${targetStatus}`,
          currentStatus: task.status,
          targetStatus,
        },
        { status: 400 }
      );
    }

    // Special handling for IN_PROGRESS → PR_REVIEW
    // This transition should typically go through submit_for_review which requires a PR
    if (task.status === "IN_PROGRESS" && targetStatus === "PR_REVIEW") {
      // Check if PR exists
      if (!task.prUrl) {
        return NextResponse.json(
          {
            error: "Cannot submit for review without a PR. Create a PR first using the CLI.",
            currentStatus: task.status,
            targetStatus,
          },
          { status: 400 }
        );
      }
    }

    // For PLANNED → BACKLOG, we also need to check if the parent issue
    // should transition from PLANNED to OPEN
    if (task.status === "PLANNED" && targetStatus === "BACKLOG") {
      const plan = context.db.plans.findById(task.planId);
      if (plan) {
        const issue = context.db.issues.findById(plan.issueId);
        if (issue && isIssueInPlanning(issue)) {
          // Transition the issue to OPEN
          context.issueService.update(issue.id, { status: "OPEN" });
        }
      }
    }

    // Update task status via service (async for external sync)
    const updatedTask = await context.taskService.updateStatus(
      taskId,
      targetStatus,
      "web-ui",
      `Status changed via kanban board: ${task.status} → ${targetStatus}`
    );

    return NextResponse.json({
      success: true,
      task: {
        id: updatedTask.id,
        number: updatedTask.number,
        title: updatedTask.title,
        status: updatedTask.status,
        previousStatus: task.status,
      },
    });
  } catch (error) {
    console.error("Error transitioning task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to transition task" },
      { status: 500 }
    );
  } finally {
    sourceProvider.closeAll();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";

export const dynamic = "force-dynamic";

interface MoveToBacklogRequest {
  projectSlug: string;
}

interface RouteParams {
  params: Promise<{
    issueNumber: string;
  }>;
}

/**
 * POST /api/issues/[issueNumber]/move-to-backlog
 *
 * Moves a PLANNED issue to OPEN status and activates all PLANNED tasks to BACKLOG.
 * This allows users to activate an issue from the UI.
 *
 * Request body:
 * {
 *   projectSlug: string
 * }
 *
 * Transitions:
 * - Issue: PLANNED → OPEN
 * - Tasks: PLANNED → BACKLOG
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { issueNumber: issueNumberStr } = await params;
    const issueNumber = parseInt(issueNumberStr, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const body = (await request.json()) as MoveToBacklogRequest;
    const { projectSlug } = body;

    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    // Create context for the project
    const registry = new DataSourceRegistry();
    const context = await WebDIContext.create(projectSlug, registry);

    // Find the issue
    const issue = context.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Validate issue status - only PLANNED issues can be moved to backlog
    if (issue.status !== "PLANNED") {
      return NextResponse.json(
        {
          error: `Issue must be in PLANNED status to move to backlog. Current status: ${issue.status}`,
          currentStatus: issue.status,
        },
        { status: 400 }
      );
    }

    // Get the plan for this issue
    const plan = context.planRepository.findByIssueId(issue.id);
    if (!plan) {
      return NextResponse.json(
        { error: "No plan found for this issue. Generate a plan first." },
        { status: 400 }
      );
    }

    // Get all tasks and filter for PLANNED ones
    const allTasks = context.taskRepository.findByPlanId(plan.id);
    const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

    // Transition all PLANNED tasks to BACKLOG
    const activatedTasks = [];
    for (const task of plannedTasks) {
      context.taskRepository.updateStatus(
        task.id,
        "BACKLOG",
        "web-ui",
        "Activated via Move to Backlog button"
      );
      activatedTasks.push({
        id: task.id,
        number: task.number,
        title: task.title,
      });
    }

    // Transition issue from PLANNED → OPEN
    context.issueRepository.update(issue.id, { status: "OPEN" });

    return NextResponse.json({
      success: true,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        previousStatus: issue.status,
        newStatus: "OPEN",
      },
      tasksActivated: activatedTasks.length,
      tasks: activatedTasks,
    });
  } catch (error) {
    console.error("Error moving issue to backlog:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to move issue to backlog" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";

export const dynamic = "force-dynamic";

interface MoveToReadyRequest {
  projectSlug: string;
}

interface RouteParams {
  params: Promise<{
    issueNumber: string;
  }>;
}

/**
 * POST /api/issues/[issueNumber]/move-to-ready
 *
 * Moves all BACKLOG tasks to READY status for an OPEN issue.
 * This allows users to mark an issue as "next up" from the UI.
 *
 * Request body:
 * {
 *   projectSlug: string
 * }
 *
 * Transitions:
 * - Tasks: BACKLOG → READY
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { issueNumber: issueNumberStr } = await params;
    const issueNumber = parseInt(issueNumberStr, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const body = (await request.json()) as MoveToReadyRequest;
    const { projectSlug } = body;

    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    // Create context for the project
    const resolver = new ProjectsResolver();
    const context = await WebDIContext.create(projectSlug, resolver, sourceProvider);

    // Find the issue
    const issue = context.db.issues.findByNumber(issueNumber);
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Validate issue status - only OPEN issues can have tasks moved to READY
    if (issue.status !== "OPEN") {
      return NextResponse.json(
        {
          error: `Issue must be in OPEN status to move tasks to ready. Current status: ${issue.status}`,
          currentStatus: issue.status,
        },
        { status: 400 }
      );
    }

    // Get the plan for this issue
    const plan = context.db.plans.findByIssueId(issue.id);
    if (!plan) {
      return NextResponse.json(
        { error: "No plan found for this issue. Generate a plan first." },
        { status: 400 }
      );
    }

    // Get all tasks and filter for BACKLOG ones
    const allTasks = context.db.tasks.findByPlanId(plan.id);
    const backlogTasks = allTasks.filter((t) => t.status === "BACKLOG");

    // Transition all BACKLOG tasks to READY via service
    const readiedTasks = [];
    for (const task of backlogTasks) {
      await context.taskService.updateStatus(
        task.id,
        "READY",
        "web-ui",
        "Readied via Move to Ready button"
      );
      readiedTasks.push({
        id: task.id,
        number: task.number,
        title: task.title,
      });
    }

    return NextResponse.json({
      success: true,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        status: issue.status,
      },
      tasksReadied: readiedTasks.length,
      tasks: readiedTasks,
    });
  } catch (error) {
    console.error("Error moving tasks to ready:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to move tasks to ready" },
      { status: 500 }
    );
  } finally {
    sourceProvider.closeAll();
  }
}

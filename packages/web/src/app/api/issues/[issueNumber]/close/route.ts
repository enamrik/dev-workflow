import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";

export const dynamic = "force-dynamic";

interface CloseIssueRequest {
  projectSlug: string;
}

interface RouteParams {
  params: Promise<{
    issueNumber: string;
  }>;
}

/**
 * POST /api/issues/[issueNumber]/close
 *
 * Closes an issue and abandons any incomplete tasks.
 *
 * Request body:
 * {
 *   projectSlug: string
 * }
 *
 * This is an irreversible action. Incomplete tasks will be abandoned.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { issueNumber: issueNumberStr } = await params;
    const issueNumber = parseInt(issueNumberStr, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const body = (await request.json()) as CloseIssueRequest;
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

    // Close the issue via service (handles task abandonment and external sync)
    const result = await context.issueService.closeIssue(issue.id, true, "web-ui");

    return NextResponse.json({
      success: true,
      issue: {
        id: result.issue.id,
        number: result.issue.number,
        title: result.issue.title,
        status: result.issue.status,
      },
      abandonedTasks: result.abandonedTasks.map((t) => ({
        id: t.task.id,
        number: t.task.number,
        title: t.task.title,
      })),
      externalIssueClosed: result.externalIssueClosed,
    });
  } catch (error) {
    console.error("Error closing issue:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to close issue" },
      { status: 500 }
    );
  } finally {
    sourceProvider.closeAll();
  }
}

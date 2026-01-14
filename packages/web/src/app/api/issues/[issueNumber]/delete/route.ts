import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import { isIssueInPlanning } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface DeleteIssueRequest {
  projectSlug: string;
}

interface RouteParams {
  params: Promise<{
    issueNumber: string;
  }>;
}

/**
 * DELETE /api/issues/[issueNumber]/delete
 *
 * Soft deletes an issue. Only PLANNED issues can be deleted.
 * Once work begins (status changes to OPEN or IN_PROGRESS), the issue cannot be deleted.
 *
 * Request body:
 * {
 *   projectSlug: string
 * }
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const sourceProvider = new DbSourceProvider();
  try {
    const { issueNumber: issueNumberStr } = await params;
    const issueNumber = parseInt(issueNumberStr, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const body = (await request.json()) as DeleteIssueRequest;
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

    // Validate issue status - only PLANNED issues can be deleted
    if (!isIssueInPlanning(issue)) {
      return NextResponse.json(
        {
          error: `Only PLANNED issues can be deleted. Current status: ${issue.status}. Use close_issue instead.`,
          currentStatus: issue.status,
        },
        { status: 400 }
      );
    }

    // Soft delete the issue via service
    const deletedIssue = context.issueService.delete(issue.id, "web-ui");

    return NextResponse.json({
      success: true,
      issue: {
        id: deletedIssue.id,
        number: deletedIssue.number,
        title: deletedIssue.title,
      },
    });
  } catch (error) {
    console.error("Error deleting issue:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete issue" },
      { status: 500 }
    );
  } finally {
    sourceProvider.closeAll();
  }
}

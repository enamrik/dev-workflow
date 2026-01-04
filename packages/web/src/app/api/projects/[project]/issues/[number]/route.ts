import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

interface RouteParams {
  params: Promise<{
    project: string;
    number: string;
  }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { project: projectId, number } = await params;
    const issueNumber = parseInt(number, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const service = getMultiProjectService();
    const result = await service.getIssue(projectId, issueNumber);

    if (!result) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching issue:", error);
    return NextResponse.json({ error: "Failed to fetch issue" }, { status: 500 });
  }
}

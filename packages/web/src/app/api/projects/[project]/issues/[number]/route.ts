import { NextRequest, NextResponse } from "next/server";
import { WebDIContext } from "@/server";

interface RouteParams {
  params: Promise<{
    project: string;
    number: string;
  }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { project: projectSlug, number } = await params;
    const issueNumber = parseInt(number, 10);

    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const context = await WebDIContext.create(projectSlug);
    const issue = context.issueRepository.findByNumber(issueNumber);

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const plan = context.planRepository.findByIssueId(issue.id);
    const tasks = plan ? context.taskRepository.findByPlanId(plan.id) : [];

    return NextResponse.json({ issue, plan, tasks });
  } catch (error) {
    console.error("Error fetching issue:", error);
    return NextResponse.json({ error: "Failed to fetch issue" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;

    const service = getMultiProjectService();

    const issuesWithTasks = await service.listTasks(projectFilter);
    const completedTasks = await service.listCompletedTasks(projectFilter);

    return NextResponse.json({
      issuesWithTasks,
      completedTasks,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

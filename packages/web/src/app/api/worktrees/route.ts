import { NextRequest, NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;

    const service = getMultiProjectService();
    const worktrees = await service.listWorktrees(projectFilter);

    return NextResponse.json({ worktrees });
  } catch (error) {
    console.error("Error fetching worktrees:", error);
    return NextResponse.json(
      { error: "Failed to fetch worktrees" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, projectId } = body;

    if (action !== "prune") {
      return NextResponse.json(
        { error: "Invalid action. Supported: prune" },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const service = getMultiProjectService();
    const result = await service.pruneWorktrees(projectId);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error pruning worktrees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to prune worktrees" },
      { status: 500 }
    );
  }
}

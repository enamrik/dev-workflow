import { NextResponse } from "next/server";
import { getMultiProjectService } from "@/lib/multi-project-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const service = getMultiProjectService();
    const projects = await service.listProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

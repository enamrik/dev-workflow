import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import { NodeGitWorktreeService, resolveConfig } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface ProjectWorktree {
  projectId: string;
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  diskUsageBytes?: number;
  taskId?: string;
  taskNumber?: number;
  taskTitle?: string;
  taskStatus?: string;
  issueNumber?: number;
}

export async function GET(request: NextRequest) {
  const sourceProvider = new DbSourceProvider();
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;

    const resolver = new ProjectsResolver();

    // Get all projects and filter manually
    let projects = await resolver.getAllProjects();
    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }

    const allWorktrees: ProjectWorktree[] = [];

    for (const project of projects) {
      try {
        const config = await resolveConfig(project.slug);
        if (!config.gitRoot) continue;

        const context = await WebDIContext.createFromProjectInfo(project, sourceProvider);

        const worktreeService = new NodeGitWorktreeService(config.gitRoot);
        const worktrees = await worktreeService.listWorktrees();

        // Build task lookup by worktree path
        const tasksByWorktreePath = new Map<
          string,
          { task: ReturnType<typeof context.db.tasks.findById>; issueNumber: number }
        >();
        const issues = context.db.issues.findMany({});

        for (const issue of issues) {
          const plan = context.db.plans.findByIssueId(issue.id);
          if (!plan) continue;

          const tasks = context.db.tasks.findByPlanId(plan.id);
          for (const task of tasks) {
            if (task.worktreePath) {
              tasksByWorktreePath.set(task.worktreePath, { task, issueNumber: issue.number });
            }
          }
        }

        for (const wt of worktrees) {
          if (wt.isMain) continue;

          const taskInfo = tasksByWorktreePath.get(wt.path);
          allWorktrees.push({
            projectId: project.projectId,
            path: wt.path,
            branch: wt.branch,
            head: wt.head,
            isMain: wt.isMain,
            diskUsageBytes: wt.diskUsageBytes,
            taskId: taskInfo?.task?.id,
            taskNumber: taskInfo?.task?.number,
            taskTitle: taskInfo?.task?.title,
            taskStatus: taskInfo?.task?.status,
            issueNumber: taskInfo?.issueNumber,
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    return NextResponse.json({ worktrees: allWorktrees });
  } catch (error) {
    console.error("Error fetching worktrees:", error);
    return NextResponse.json({ error: "Failed to fetch worktrees" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, projectId } = body;

    if (action !== "prune") {
      return NextResponse.json({ error: "Invalid action. Supported: prune" }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const resolver = new ProjectsResolver();
    const allProjects = await resolver.getAllProjects();
    const project = allProjects.find((p) => p.projectId === projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const config = await resolveConfig(project.slug);
    if (!config.gitRoot) {
      throw new Error(
        "Project config.json not found. Run 'dev-workflow init' in the project directory first."
      );
    }

    const worktreeService = new NodeGitWorktreeService(config.gitRoot);

    const beforeCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;
    await worktreeService.pruneWorktrees();
    const afterCount = (await worktreeService.listWorktrees()).filter((w) => !w.isMain).length;

    return NextResponse.json({ success: true, pruned: beforeCount - afterCount });
  } catch (error) {
    console.error("Error pruning worktrees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to prune worktrees" },
      { status: 500 }
    );
  }
}

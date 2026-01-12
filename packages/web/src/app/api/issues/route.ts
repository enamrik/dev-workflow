import { NextRequest, NextResponse } from "next/server";
import { ProjectsResolver, DbSourceProvider, WebDIContext } from "@/server";
import type { Issue, ComputedIssueStatus, TaskCounts } from "@dev-workflow/core";

export const dynamic = "force-dynamic";

interface IssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: TaskCounts;
  computedStatus: ComputedIssueStatus;
  projectName?: string;
  projectSlug?: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

export async function GET(request: NextRequest) {
  const sourceProvider = new DbSourceProvider();
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;
    const sourceFilter = searchParams.get("source") ?? undefined;

    const resolver = new ProjectsResolver();

    // Get all projects and filter manually
    let projects = await resolver.getAllProjects();
    if (projectFilter) {
      projects = projects.filter((p) => p.projectId === projectFilter || p.slug === projectFilter);
    }
    if (sourceFilter) {
      projects = projects.filter((p) => p.slug === sourceFilter);
    }

    const allIssues: IssueWithPlanInfo[] = [];

    for (const project of projects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, sourceProvider);
        const issues = context.db.issues.findMany({});

        for (const issue of issues) {
          const { computedStatus, taskCounts } = context.issueStatusService.computeStatus(issue);

          let milestoneNumber: number | undefined;
          let milestoneTitle: string | undefined;
          if (issue.milestoneId) {
            const milestone = context.db.milestones.findById(issue.milestoneId);
            if (milestone) {
              milestoneNumber = milestone.number;
              milestoneTitle = milestone.title;
            }
          }

          allIssues.push({
            issue,
            hasPlan: !!context.db.plans.findByIssueId(issue.id),
            taskCounts,
            computedStatus,
            projectName: project.name,
            projectSlug: project.slug,
            milestoneNumber,
            milestoneTitle,
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort: by project, then by issue number descending
    allIssues.sort((a, b) => {
      if (a.issue.projectId !== b.issue.projectId) {
        return a.issue.projectId.localeCompare(b.issue.projectId);
      }
      return b.issue.number - a.issue.number;
    });

    return NextResponse.json(allIssues);
  } catch (error) {
    console.error("Error fetching issues:", error);
    return NextResponse.json({ error: "Failed to fetch issues" }, { status: 500 });
  } finally {
    sourceProvider.closeAll();
  }
}

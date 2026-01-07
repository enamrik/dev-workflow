import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
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
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectFilter = searchParams.get("project") ?? undefined;
    const sourceFilter = searchParams.get("source") ?? undefined;

    const registry = new DataSourceRegistry();
    const { projects } = await registry.getSourcesWithProjects();

    // Filter projects
    let filteredProjects = projects;
    if (projectFilter) {
      filteredProjects = filteredProjects.filter((p) => p.id === projectFilter);
    }
    if (sourceFilter) {
      filteredProjects = filteredProjects.filter((p) => p.sourceId === sourceFilter);
    }

    const allIssues: IssueWithPlanInfo[] = [];

    for (const project of filteredProjects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, registry);
        const issues = context.issueRepository.findMany({});

        for (const issue of issues) {
          const { computedStatus, taskCounts } = context.issueStatusService.computeStatus(issue);

          let milestoneNumber: number | undefined;
          let milestoneTitle: string | undefined;
          if (issue.milestoneId) {
            const milestone = context.milestoneRepository.findById(issue.milestoneId);
            if (milestone) {
              milestoneNumber = milestone.number;
              milestoneTitle = milestone.title;
            }
          }

          allIssues.push({
            issue,
            hasPlan: !!context.planRepository.findByIssueId(issue.id),
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
  }
}

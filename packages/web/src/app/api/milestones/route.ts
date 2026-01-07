import { NextRequest, NextResponse } from "next/server";
import { DataSourceRegistry, WebDIContext } from "@/server";
import {
  computeMilestoneStatus,
  type MilestoneIssueStats,
  type ComputedIssueStatus,
} from "@dev-workflow/core";

export const dynamic = "force-dynamic";

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

    const result: {
      milestone: {
        id: string;
        number: number;
        title: string;
        description: string | null;
        startDate: string;
        endDate: string;
        status: string;
        projectId: string;
        createdAt: string;
        updatedAt: string;
        projectName: string;
        projectSlug: string;
      };
      issues: {
        number: number;
        title: string;
        status: string;
        computedStatus: ComputedIssueStatus;
        type: string;
      }[];
      progress: {
        total: number;
        closed: number;
        percentage: number;
      };
    }[] = [];

    for (const project of filteredProjects) {
      try {
        const context = await WebDIContext.createFromProjectInfo(project, registry);
        const milestones = context.milestoneRepository.findMany();

        for (const milestone of milestones) {
          const issues = context.issueRepository.findMany({ milestoneId: milestone.id });
          const closedIssues = issues.filter((i) => i.status === "CLOSED").length;

          const milestoneIssueStats: MilestoneIssueStats = {
            totalIssues: issues.length,
            closedIssues,
            openOrInProgressIssues: issues.filter(
              (i) => i.status === "OPEN" || i.status === "IN_PROGRESS"
            ).length,
          };

          const computedMilestoneStatus = computeMilestoneStatus(
            milestone.status,
            milestoneIssueStats,
            milestone.endDate
          );

          const issuesWithStatus = issues.map((issue) => {
            const { computedStatus } = context.issueStatusService.computeStatus(issue);
            return {
              number: issue.number,
              title: issue.title,
              status: issue.status,
              computedStatus,
              type: issue.type,
            };
          });

          result.push({
            milestone: {
              ...milestone,
              status: computedMilestoneStatus,
              projectName: project.name,
              projectSlug: project.slug,
            },
            issues: issuesWithStatus,
            progress: {
              total: issues.length,
              closed: closedIssues,
              percentage: issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
            },
          });
        }
      } catch {
        // Skip inaccessible projects
      }
    }

    // Sort by start date
    result.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching milestones:", error);
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 });
  }
}

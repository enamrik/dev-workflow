/**
 * listAllIssues - List issues across all projects with computed status
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  IssueStatusService,
  type Issue,
  type ComputedIssueStatus,
  type TaskCounts,
} from "@dev-workflow/tracking";
import { getDbClient, filterProjects } from "./helpers";

// =============================================================================
// Schema
// =============================================================================

export const ListAllIssuesSchema = z.object({
  projectFilter: z.string().optional(),
});
export type ListAllIssuesInput = z.infer<typeof ListAllIssuesSchema>;

// =============================================================================
// Types
// =============================================================================

export interface IssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: TaskCounts;
  computedStatus: ComputedIssueStatus;
  projectName?: string;
  projectSlug?: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

// =============================================================================
// Operation
// =============================================================================

export function listAllIssues(input: ListAllIssuesInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const validated = validateInput(ListAllIssuesSchema, input);
    const projects = filterProjects(
      yield* projectsResolver.getAllProjects(),
      validated.projectFilter
    );

    const allIssues: IssueWithPlanInfo[] = [];

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const issues = yield* db.issues.findMany({});
        const statusService = new IssueStatusService(db);

        for (const issue of issues) {
          const { computedStatus, taskCounts } = yield* statusService.computeStatus(issue);

          let milestoneNumber: number | undefined;
          let milestoneTitle: string | undefined;
          if (issue.milestoneId) {
            const milestone = yield* db.milestones.findById(issue.milestoneId);
            if (milestone) {
              milestoneNumber = milestone.number;
              milestoneTitle = milestone.title;
            }
          }

          allIssues.push({
            issue,
            hasPlan: !!(yield* db.plans.findByIssueId(issue.id)),
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

    allIssues.sort((a, b) => {
      if (a.issue.projectId !== b.issue.projectId) {
        return a.issue.projectId.localeCompare(b.issue.projectId);
      }
      return b.issue.number - a.issue.number;
    });

    return allIssues;
  });
}

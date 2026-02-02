/**
 * listAllMilestones / getMilestonesWithDetails - Milestone queries across projects
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  IssueStatusService,
  Milestone,
  type ComputedIssueStatus,
  type MilestoneIssueStats,
} from "@dev-workflow/tracking";
import { getDbClient, filterProjects } from "./helpers";

const { runPromise } = Effect;

// =============================================================================
// Schemas
// =============================================================================

export const ListAllMilestonesSchema = z.object({
  projectFilter: z.string().optional(),
});
export type ListAllMilestonesInput = z.infer<typeof ListAllMilestonesSchema>;

export const GetMilestonesWithDetailsSchema = z.object({
  projectFilter: z.string().optional(),
  sourceFilter: z.string().optional(),
});
export type GetMilestonesWithDetailsInput = z.infer<typeof GetMilestonesWithDetailsSchema>;

// =============================================================================
// Types
// =============================================================================

export interface MilestoneWithProject extends Milestone {
  projectSlug: string;
  projectName: string;
}

export interface MilestoneIssueInfo {
  number: number;
  title: string;
  status: string;
  computedStatus: ComputedIssueStatus;
  type: string;
}

export interface MilestoneProgress {
  total: number;
  closed: number;
  percentage: number;
}

export interface MilestoneWithDetails {
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
  issues: MilestoneIssueInfo[];
  progress: MilestoneProgress;
}

// =============================================================================
// Operations
// =============================================================================

export function listAllMilestones(input: ListAllMilestonesInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    return yield* Effect.promise(async () => {
      const validated = validateInput(ListAllMilestonesSchema, input);
      const projects = filterProjects(
        await projectsResolver.getAllProjects(),
        validated.projectFilter
      );

      const allMilestones: MilestoneWithProject[] = [];

      for (const project of projects) {
        try {
          const db = await getDbClient(project, sourceProvider);
          const milestones = await runPromise(db.milestones.findMany());

          for (const milestone of milestones) {
            allMilestones.push({
              ...milestone,
              projectSlug: project.slug,
              projectName: project.name,
            });
          }
        } catch {
          // Skip inaccessible projects
        }
      }

      return allMilestones;
    });
  });
}

export function getMilestonesWithDetails(input: GetMilestonesWithDetailsInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    return yield* Effect.promise(async () => {
      const validated = validateInput(GetMilestonesWithDetailsSchema, input);
      let projects = filterProjects(
        await projectsResolver.getAllProjects(),
        validated.projectFilter
      );

      if (validated.sourceFilter) {
        projects = projects.filter((p) => p.slug === validated.sourceFilter);
      }

      const result: MilestoneWithDetails[] = [];

      for (const project of projects) {
        try {
          const db = await getDbClient(project, sourceProvider);
          const milestones = await runPromise(db.milestones.findMany());
          const statusService = new IssueStatusService(db);

          for (const milestone of milestones) {
            const issues = await runPromise(db.issues.findMany({ milestoneId: milestone.id }));
            const closedIssues = issues.filter((i) => i.isClosed).length;

            const milestoneIssueStats: MilestoneIssueStats = {
              totalIssues: issues.length,
              closedIssues,
              openOrInProgressIssues: issues.filter((i) => !i.isClosed && !i.isInPlanning).length,
            };

            const computedMilestoneStatus = Milestone.computeStatus(
              milestone.status,
              milestoneIssueStats,
              milestone.endDate
            );

            const issuesWithStatus = await Promise.all(
              issues.map(async (issue) => {
                const { computedStatus } = await statusService.computeStatus(issue);
                return {
                  number: issue.number,
                  title: issue.title,
                  status: issue.status,
                  computedStatus,
                  type: issue.type,
                };
              })
            );

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
                percentage:
                  issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
              },
            });
          }
        } catch {
          // Skip inaccessible projects
        }
      }

      result.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));
      return result;
    });
  });
}

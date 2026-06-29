/**
 * listAllMilestones / getMilestonesWithDetails - Global milestone queries
 *
 * Milestones are global: a single milestone groups issues from any project.
 * These operations fetch milestones ONCE from the global store and attach
 * project context at the ISSUE level (each issue carries its owning project's
 * slug/name), not at the milestone level.
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
import { getDbSource } from "./helpers.js";

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

/**
 * An issue belonging to a (global) milestone, tagged with its owning project.
 */
export interface MilestoneIssueInfo {
  number: number;
  title: string;
  status: string;
  computedStatus: ComputedIssueStatus;
  type: string;
  projectSlug: string;
  projectName: string;
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
    createdAt: string;
    updatedAt: string;
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

    validateInput(ListAllMilestonesSchema, input);

    // All projects share the same global tracking database, so any project's
    // source exposes the global milestone store. With no projects there are no
    // milestones to list.
    const projects = yield* projectsResolver.getAllProjects();
    const firstProject = projects[0];
    if (!firstProject) {
      return [] as Milestone[];
    }

    const source = yield* Effect.promise(() => getDbSource(firstProject, sourceProvider));
    return yield* source.milestones.findMany();
  });
}

export function getMilestonesWithDetails(input: GetMilestonesWithDetailsInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const validated = validateInput(GetMilestonesWithDetailsSchema, input);

    const projects = yield* projectsResolver.getAllProjects();
    const firstProject = projects[0];
    if (!firstProject) {
      return [] as MilestoneWithDetails[];
    }

    // Optional project filter (by slug or projectId) limits which issues count
    // toward a milestone's progress / issue list. A milestone no longer belongs
    // to a single project, so the filter applies at the issue level.
    const projectFilter = validated.sourceFilter ?? validated.projectFilter;

    const source = yield* Effect.promise(() => getDbSource(firstProject, sourceProvider));
    // plans/tasks repositories are global lookups by id, so any project-scoped
    // client can compute issue status for issues from any project.
    const statusClient = source.createClient(firstProject.projectId);
    const statusService = new IssueStatusService(statusClient);

    const milestones = yield* source.milestones.findMany();
    const result: MilestoneWithDetails[] = [];

    for (const milestone of milestones) {
      const members = yield* source.milestoneIssues.findIssuesByMilestoneId(milestone.id);

      const matching = projectFilter
        ? members.filter((m) => m.projectSlug === projectFilter || m.projectId === projectFilter)
        : members;

      const closedIssues = matching.filter((m) => m.issue.isClosed).length;

      const milestoneIssueStats: MilestoneIssueStats = {
        totalIssues: matching.length,
        closedIssues,
        openOrInProgressIssues: matching.filter((m) => !m.issue.isClosed && !m.issue.isInPlanning)
          .length,
      };

      const computedMilestoneStatus = Milestone.computeStatus(
        milestone.status,
        milestoneIssueStats,
        milestone.endDate
      );

      const issuesWithStatus: MilestoneIssueInfo[] = [];
      for (const member of matching) {
        const { computedStatus } = yield* statusService.computeStatus(member.issue);
        issuesWithStatus.push({
          number: member.issue.number,
          title: member.issue.title,
          status: member.issue.status,
          computedStatus,
          type: member.issue.type,
          projectSlug: member.projectSlug,
          projectName: member.projectName,
        });
      }

      result.push({
        milestone: {
          ...milestone,
          status: computedMilestoneStatus,
        },
        issues: issuesWithStatus,
        progress: {
          total: matching.length,
          closed: closedIssues,
          percentage: matching.length > 0 ? Math.round((closedIssues / matching.length) * 100) : 0,
        },
      });
    }

    result.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));
    return result;
  });
}

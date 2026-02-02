/**
 * getWorktreesWithTaskInfo - List worktrees enriched with task information
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  type Task,
} from "@dev-workflow/tracking";
import { WorktreeServiceFactoryTag } from "../di/service-tags";
import { getDbClient, filterProjects } from "./helpers";

// =============================================================================
// Schema
// =============================================================================

export const GetWorktreesWithTaskInfoSchema = z.object({
  projectFilter: z.string().optional(),
});
export type GetWorktreesWithTaskInfoInput = z.infer<typeof GetWorktreesWithTaskInfoSchema>;

// =============================================================================
// Types
// =============================================================================

export interface ProjectWorktree {
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

// =============================================================================
// Operation
// =============================================================================

export function getWorktreesWithTaskInfo(input: GetWorktreesWithTaskInfoInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;
    const createWorktreeService = yield* WorktreeServiceFactoryTag;

    const validated = validateInput(GetWorktreesWithTaskInfoSchema, input);
    const projects = filterProjects(
      yield* projectsResolver.getAllProjects(),
      validated.projectFilter
    );

    const allWorktrees: ProjectWorktree[] = [];

    for (const project of projects) {
      try {
        if (!project.gitRoot) continue;

        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const worktreeService = createWorktreeService(project.gitRoot);
        const worktrees = yield* worktreeService.listWorktrees();

        const tasksByWorktreePath = new Map<string, { task: Task; issueNumber: number }>();
        const issues = yield* db.issues.findMany({});

        for (const issue of issues) {
          const plan = yield* db.plans.findByIssueId(issue.id);
          if (!plan) continue;

          const tasks = yield* db.tasks.findByPlanId(plan.id);
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

    return allWorktrees;
  });
}

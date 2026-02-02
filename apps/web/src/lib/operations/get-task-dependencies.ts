/**
 * getTaskDependencies - Find task dependencies across all projects
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  EntityNotFoundError,
  Task,
} from "@dev-workflow/tracking";
import { getDbClient } from "./helpers";

// =============================================================================
// Schema
// =============================================================================

export const GetTaskDependenciesSchema = z.object({
  taskId: z.string().min(1),
});
export type GetTaskDependenciesInput = z.infer<typeof GetTaskDependenciesSchema>;

// =============================================================================
// Types
// =============================================================================

export interface TaskDependencyWithIssue extends Task {
  issueNumber: number | null;
}

// =============================================================================
// Operation
// =============================================================================

export function getTaskDependencies(input: GetTaskDependenciesInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const validated = validateInput(GetTaskDependenciesSchema, input);
    const projects = yield* projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const task = yield* db.tasks.findById(validated.taskId);

        if (task) {
          if (!task.dependsOn || task.dependsOn.length === 0) {
            return [];
          }
          const dependencies = yield* db.tasks.findByIds(task.dependsOn);
          const result: TaskDependencyWithIssue[] = [];
          for (const dep of dependencies) {
            const depPlan = yield* db.plans.findById(dep.planId);
            const depIssue = depPlan ? yield* db.issues.findById(depPlan.issueId) : null;
            result.push(
              Object.assign(Task.from(dep), {
                issueNumber: depIssue?.number ?? null,
              })
            );
          }
          return result;
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", validated.taskId);
  });
}

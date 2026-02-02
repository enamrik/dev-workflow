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

    return yield* Effect.promise(async (): Promise<TaskDependencyWithIssue[]> => {
      const validated = validateInput(GetTaskDependenciesSchema, input);
      const projects = await projectsResolver.getAllProjects();

      for (const project of projects) {
        try {
          const db = await getDbClient(project, sourceProvider);
          const task = await Effect.runPromise(db.tasks.findById(validated.taskId));

          if (task) {
            if (!task.dependsOn || task.dependsOn.length === 0) {
              return [];
            }
            const dependencies = await Effect.runPromise(db.tasks.findByIds(task.dependsOn));
            return await Promise.all(
              dependencies.map(async (dep) => {
                const depPlan = await db.plans.findById(dep.planId);
                const depIssue = depPlan
                  ? await Effect.runPromise(db.issues.findById(depPlan.issueId))
                  : null;
                return Object.assign(Task.from(dep), {
                  issueNumber: depIssue?.number ?? null,
                });
              })
            );
          }
        } catch {
          // Continue searching
        }
      }

      throw new EntityNotFoundError("Task", validated.taskId);
    });
  });
}

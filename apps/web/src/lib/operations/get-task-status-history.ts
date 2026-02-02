/**
 * getTaskStatusHistory - Find task status history across all projects
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  EntityNotFoundError,
  type TaskStatusHistory,
} from "@dev-workflow/tracking";
import { getDbClient } from "./helpers";

// =============================================================================
// Schema
// =============================================================================

export const GetTaskStatusHistorySchema = z.object({
  taskId: z.string().min(1),
});
export type GetTaskStatusHistoryInput = z.infer<typeof GetTaskStatusHistorySchema>;

// =============================================================================
// Operation
// =============================================================================

export function getTaskStatusHistory(input: GetTaskStatusHistoryInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    return yield* Effect.promise(async (): Promise<TaskStatusHistory[]> => {
      const validated = validateInput(GetTaskStatusHistorySchema, input);
      const projects = await projectsResolver.getAllProjects();

      for (const project of projects) {
        try {
          const db = await getDbClient(project, sourceProvider);
          const task = await Effect.runPromise(db.tasks.findById(validated.taskId));

          if (task) {
            return await Effect.runPromise(db.tasks.getStatusHistory(validated.taskId));
          }
        } catch {
          // Continue searching
        }
      }

      throw new EntityNotFoundError("Task", validated.taskId);
    });
  });
}

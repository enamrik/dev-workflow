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
} from "@dev-workflow/tracking";
import { getDbClient } from "./helpers.js";

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

    const validated = validateInput(GetTaskStatusHistorySchema, input);
    const projects = yield* projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const task = yield* db.tasks.findById(validated.taskId);

        if (task) {
          return yield* db.tasks.getStatusHistory(validated.taskId);
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", validated.taskId);
  });
}

/**
 * getTaskExecutionLogs - Find task execution logs across all projects
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  validateInput,
  ProjectsResolver,
  DbSourceProvider,
  EntityNotFoundError,
} from "@dev-workflow/tracking";
import { getDbClient } from "./helpers";

// =============================================================================
// Schema
// =============================================================================

export const GetTaskExecutionLogsSchema = z.object({
  taskId: z.string().min(1),
});
export type GetTaskExecutionLogsInput = z.infer<typeof GetTaskExecutionLogsSchema>;

// =============================================================================
// Operation
// =============================================================================

export function getTaskExecutionLogs(input: GetTaskExecutionLogsInput) {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const validated = validateInput(GetTaskExecutionLogsSchema, input);
    const projects = yield* projectsResolver.getAllProjects();

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const task = yield* db.tasks.findById(validated.taskId);

        if (task) {
          return yield* db.executionLogs.findByTaskId(validated.taskId);
        }
      } catch {
        // Continue searching
      }
    }

    throw new EntityNotFoundError("Task", validated.taskId);
  });
}

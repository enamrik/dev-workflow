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
  type ExecutionLog,
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

    return yield* Effect.promise(async (): Promise<ExecutionLog[]> => {
      const validated = validateInput(GetTaskExecutionLogsSchema, input);
      const projects = await projectsResolver.getAllProjects();

      for (const project of projects) {
        try {
          const db = await getDbClient(project, sourceProvider);
          const task = await Effect.runPromise(db.tasks.findById(validated.taskId));

          if (task) {
            return await db.executionLogs.findByTaskId(validated.taskId);
          }
        } catch {
          // Continue searching
        }
      }

      throw new EntityNotFoundError("Task", validated.taskId);
    });
  });
}

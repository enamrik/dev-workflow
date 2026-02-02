/**
 * listAvailableTasks - List tasks available to work on
 *
 * Finds tasks that are available (non-terminal) and filters by availability
 * check (dependencies satisfied, parent issue not closed). Can filter by
 * planId or issueNumber.
 */

import { z } from "zod";
import { Task } from "../../domain/tasks/task.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { TaskSessionService } from "../../domain/tasks/task-session-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const listAvailableTasksSchema = z.object({
  planId: z.string().min(1).optional(),
  issueNumber: z.number().int().positive().optional(),
});

export type ListAvailableTasksInput = z.infer<typeof listAvailableTasksSchema>;

// =============================================================================
// Types
// =============================================================================

export interface ListAvailableTasksResult {
  success: boolean;
  tasks: Array<Task & { isAvailable: boolean; blockedBy: string[] }>;
}

// =============================================================================
// Operation
// =============================================================================

export function listAvailableTasks(input: ListAvailableTasksInput) {
  return Effect.gen(function* () {
    const { planId, issueNumber } = validateInput(listAvailableTasksSchema, input);
    const taskService = yield* TaskService;
    const taskSessionService = yield* TaskSessionService;
    const issueService = yield* IssueService;
    const planService = yield* PlanService;

    let tasks: Awaited<ReturnType<typeof taskService.findMany>> = [];

    if (planId) {
      tasks = yield* Effect.promise(() => taskService.findByPlanId(planId));
    } else if (issueNumber) {
      const issue = yield* issueService.findByNumber(issueNumber);
      if (issue) {
        const plan = yield* Effect.promise(() => planService.findByIssueId(issue.id));
        if (plan) {
          tasks = yield* Effect.promise(() => taskService.findByPlanId(plan.id));
        }
      }
    } else {
      tasks = yield* Effect.promise(() => taskService.findMany({}));
    }

    // Filter to only available tasks and include availability info
    const availableTasks: Array<Task & { isAvailable: boolean; blockedBy: string[] }> = [];
    for (const task of tasks) {
      const isAvailable = yield* Effect.promise(() => taskSessionService.isTaskAvailable(task.id));
      if (isAvailable) {
        availableTasks.push(
          Object.assign(Task.from(task), {
            isAvailable: true as const,
            blockedBy: [] as string[],
          })
        );
      }
    }

    return {
      success: true,
      tasks: availableTasks,
    } satisfies ListAvailableTasksResult;
  });
}

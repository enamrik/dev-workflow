/**
 * listAvailableTasks - List tasks available to work on
 *
 * Finds tasks that are available (non-terminal) and filters by availability
 * check (dependencies satisfied, parent issue not closed). Can filter by
 * planId or issueNumber.
 */

import { z } from "zod";
import { Task } from "../../domain/tasks/task.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
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
    const taskDomainService = yield* TaskDomainService;
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;

    let tasks: Task[] = [];

    if (planId) {
      tasks = yield* taskDomainService.findByPlanId(planId);
    } else if (issueNumber) {
      const issue = yield* issueDomainService.findByNumber(issueNumber);
      if (issue) {
        const plan = yield* planDomainService.findByIssueId(issue.id);
        if (plan) {
          tasks = yield* taskDomainService.findByPlanId(plan.id);
        }
      }
    } else {
      tasks = yield* taskDomainService.findMany({});
    }

    // Filter to only available tasks and include availability info
    const availableTasks: Array<Task & { isAvailable: boolean; blockedBy: string[] }> = [];
    for (const task of tasks) {
      const isAvailable = yield* taskDomainService.isTaskAvailable(task.id);
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

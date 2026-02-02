/**
 * moveIssueTasks - Transition an issue's tasks between BACKLOG and READY
 *
 * Supports two directions:
 * - "ready": BACKLOG → READY (issue must be OPEN)
 * - "backlog": READY → BACKLOG (pause)
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const moveIssueTasksSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
  direction: z.enum(["ready", "backlog"]),
});

export type MoveIssueTasksInput = z.infer<typeof moveIssueTasksSchema>;

// =============================================================================
// Types
// =============================================================================

export interface MoveIssueTasksResult {
  issue: Issue;
  tasksUpdated: number;
  tasks: Array<{ id: string; number: number; title: string }>;
}

// =============================================================================
// Operation
// =============================================================================

export function moveIssueTasks(input: MoveIssueTasksInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber, direction } = validateInput(moveIssueTasksSchema, input);
    const domain = yield* DomainExecutorFactory;
    const { issues, plans, tasks } = yield* domain.forProject(projectSlug);

    const issue = yield* issues.getByNumber(issueNumber);

    if (direction === "ready" && issue.status !== "OPEN") {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Issue must be in OPEN status to move tasks to ready. Current status: ${issue.status}`
        )
      );
    }

    const plan = yield* plans.findByIssueId(issue.id);
    if (!plan) {
      if (direction === "ready") {
        return yield* Effect.fail(
          new BusinessRuleError("No plan found for this issue. Generate a plan first.")
        );
      }
      return { issue, tasksUpdated: 0, tasks: [] };
    }

    const allTasks = yield* tasks.findByPlanId(plan.id);
    const updated: Array<{ id: string; number: number; title: string }> = [];

    for (const task of allTasks) {
      if (direction === "ready" && task.status === "BACKLOG") {
        yield* tasks.moveToReady(task.id, "web-ui");
        updated.push({ id: task.id, number: task.number, title: task.title });
      } else if (direction === "backlog" && task.status === "READY") {
        yield* tasks.moveToBacklog(task.id, "web-ui");
        updated.push({ id: task.id, number: task.number, title: task.title });
      }
    }

    return { issue, tasksUpdated: updated.length, tasks: updated };
  });
}

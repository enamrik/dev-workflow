/**
 * moveIssueToReady - Move BACKLOG tasks to READY and sync status to external provider
 *
 * Marks an issue as "next up" by transitioning all BACKLOG tasks to READY,
 * then syncs each task's READY status to the external provider.
 */

import { z } from "zod";
import { PlanningService } from "../../domain/plans/planning-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const MoveIssueToReadySchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type MoveIssueToReadyInput = z.infer<typeof MoveIssueToReadySchema>;

export interface MoveIssueToReadyResult {
  message: string;
  tasksMovedCount: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Move an issue's tasks from BACKLOG to READY.
 *
 * 1. Validate input
 * 2. Call planningService.readyIssue to transition BACKLOG → READY
 * 3. Sync each task's READY status to external provider
 * 4. Return summary
 */
export function moveIssueToReady(input: MoveIssueToReadyInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(MoveIssueToReadySchema, input);
    const planningService = yield* PlanningService;
    const taskService = yield* TaskService;

    const result = yield* planningService.readyIssue(issueNumber);

    // Sync each task's READY status to GitHub
    for (const task of result.tasks) {
      yield* taskService.syncTaskStatus(task.id, "READY");
    }

    return {
      message:
        result.count > 0
          ? `Issue #${issueNumber} is ready: ${result.count} task(s) moved from BACKLOG to READY`
          : `Issue #${issueNumber} has no BACKLOG tasks to ready`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    } satisfies MoveIssueToReadyResult;
  });
}

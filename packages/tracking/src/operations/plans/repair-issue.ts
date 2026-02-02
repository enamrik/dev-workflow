/**
 * repairIssue - Repair GitHub sync state for all tasks in an issue
 *
 * Checks that GitHub sync is enabled, then repairs the sync state
 * for each task in the issue. Creates, links, or verifies external
 * issues as needed.
 */

import { z } from "zod";
import { TaskService } from "../../domain/tasks/task-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RepairIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type RepairIssueInput = z.infer<typeof RepairIssueSchema>;

export interface RepairIssueResult {
  message: string;
  issueNumber: number;
  tasksProcessed: number;
  created: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  linked: Array<{ taskNumber: number; githubIssueNumber: number | null; githubUrl: string | null }>;
  verified: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  skipped: Array<{ taskNumber: number; reason: string | undefined }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Repair GitHub sync state for an issue.
 *
 * 1. Validate input
 * 2. Verify GitHub sync is enabled
 * 3. Call taskService.repairIssue to process all tasks
 * 4. Build summary from created/linked/verified/skipped counts
 */
export function repairIssue(input: RepairIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(RepairIssueSchema, input);
    const taskService = yield* TaskService;

    // 1. Verify sync is enabled (synchronous check)
    if (!taskService.isSyncEnabled()) {
      throw new Error("GitHub sync is not enabled for this project");
    }

    // 2. Repair issue
    const result = yield* taskService.repairIssue(issueNumber);

    if (!result.success && result.errors.length > 0) {
      const errorMessages = result.errors.map((e) => e.error).join("; ");
      throw new Error(`Sync completed with errors: ${errorMessages}`);
    }

    // 3. Build summary message
    const parts: string[] = [];
    if (result.created.length > 0) {
      parts.push(`${result.created.length} created`);
    }
    if (result.linked.length > 0) {
      parts.push(`${result.linked.length} linked`);
    }
    if (result.verified.length > 0) {
      parts.push(`${result.verified.length} verified`);
    }
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} skipped`);
    }

    const summary = parts.length > 0 ? parts.join(", ") : "no tasks to sync";

    return {
      message: `Issue #${issueNumber} sync complete: ${summary}`,
      issueNumber: result.issueNumber,
      tasksProcessed: result.tasksProcessed,
      created: result.created.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      linked: result.linked.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      verified: result.verified.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      skipped: result.skipped.map((t) => ({
        taskNumber: t.taskNumber,
        reason: t.error,
      })),
    } satisfies RepairIssueResult;
  });
}

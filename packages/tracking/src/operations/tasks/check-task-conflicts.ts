/**
 * checkTaskConflicts - Detect file conflicts before starting a task
 *
 * Analyzes execution logs from completed tasks to detect potential
 * file conflicts. Returns warnings (non-blocking) with file paths
 * and the prior tasks that modified them.
 */

import { z } from "zod";
import type { ConflictWarning } from "../../conflict-detection-service.js";
import { ConflictDetectionService } from "../../conflict-detection-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const checkTaskConflictsSchema = z.object({
  taskId: z.string().min(1),
});

export type CheckTaskConflictsInput = z.infer<typeof checkTaskConflictsSchema>;

// =============================================================================
// Types
// =============================================================================

export interface CheckTaskConflictsResult {
  success: boolean;
  taskId: string;
  taskTitle?: string;
  hasConflicts: boolean;
  warnings: ConflictWarning[];
  warningMessage?: string;
  message?: string;
  priorTaskFiles?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

function formatConflictWarnings(warnings: ConflictWarning[], issueNumber?: number | null): string {
  const lines = ["\u26a0\ufe0f Potential file conflicts detected:"];
  for (const warning of warnings) {
    const modifiers = warning.modifiedBy
      .map((m) => {
        const storyRef =
          issueNumber != null ? `#${issueNumber}.${m.taskNumber}` : `#${m.taskNumber}`;
        return `${storyRef} ${m.taskTitle}`;
      })
      .join(", ");
    lines.push(`  - ${warning.filePath} was modified by: ${modifiers}`);
  }
  lines.push("");
  lines.push("These files were touched by prior tasks. Review carefully when making changes.");
  return lines.join("\n");
}

// =============================================================================
// Operation
// =============================================================================

export function checkTaskConflicts(input: CheckTaskConflictsInput) {
  return Effect.gen(function* () {
    const { taskId } = validateInput(checkTaskConflictsSchema, input);
    const taskService = yield* TaskService;
    const conflictDetectionService = yield* ConflictDetectionService;
    const planService = yield* PlanService;
    const issueService = yield* IssueService;

    // Verify task exists
    const task = yield* Effect.promise(() => taskService.findById(taskId));
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Run conflict detection
    const result = yield* Effect.promise(() => conflictDetectionService.detectConflicts(taskId));

    // Build response
    const response: CheckTaskConflictsResult = {
      success: true,
      taskId,
      taskTitle: task.title,
      hasConflicts: result.hasConflicts,
      warnings: result.warnings,
    };

    if (result.hasConflicts) {
      // Get issue number for #issue.task format in warning message
      const taskPlan = yield* Effect.promise(() => planService.findById(task.planId));
      const taskIssue = taskPlan ? yield* issueService.findById(taskPlan.issueId) : null;
      response.warningMessage = formatConflictWarnings(result.warnings, taskIssue?.number);
    } else {
      response.message = "No potential conflicts detected with prior tasks";
    }

    // Include summary of all files modified by prior tasks for context
    if (result.priorTaskFiles.size > 0) {
      const filesModifiedByPriorTasks: string[] = [];
      for (const filePath of result.priorTaskFiles.keys()) {
        filesModifiedByPriorTasks.push(filePath);
      }
      response.priorTaskFiles = filesModifiedByPriorTasks;
    }

    return response satisfies CheckTaskConflictsResult;
  });
}

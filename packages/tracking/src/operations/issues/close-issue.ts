/**
 * closeIssue - Close an issue and optionally abandon incomplete tasks
 *
 * Orchestrates domain services.
 * Uses transaction when abandoning multiple tasks.
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const CloseIssueSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
  force: z.boolean().optional().default(false),
  closedBy: z.string().optional(),
});
export type CloseIssueInput = z.infer<typeof CloseIssueSchema>;

export interface CloseIssueResult {
  issue: Issue;
  abandonedTasks: Task[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Close an issue.
 *
 * 1. Validate input and resolve project domain
 * 2. Check issue exists and is not already closed
 * 3. Check for incomplete tasks (error unless force=true)
 * 4. Force mode: abandon incomplete tasks + close issue (transaction)
 */
export function closeIssue(input: CloseIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber, force, closedBy } = validateInput(CloseIssueSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    // 1. Validate
    const issue = yield* pd.issues.getByNumber(issueNumber);
    if (issue.isClosed) {
      return {
        issue,
        abandonedTasks: [],
      };
    }

    // 2. Check incomplete tasks
    const incompleteTasks = yield* pd.tasks.getIncompleteTasksForIssue(issue.id);
    if (incompleteTasks.length > 0 && !force) {
      const taskList = incompleteTasks
        .map((t) => `#${t.number} ${t.title} (${t.status})`)
        .join(", ");
      return yield* Effect.fail(
        new BusinessRuleError(
          `Cannot close issue: ${incompleteTasks.length} task(s) are not complete: ${taskList}. Use force=true to abandon them.`
        )
      );
    }

    // 3. Atomic writes (abandon tasks + close issue)
    const result = yield* pd.transaction(({ issues, tasks }) =>
      Effect.gen(function* () {
        const abandoned: Task[] = [];
        for (const task of incompleteTasks) {
          abandoned.push(yield* tasks.abandon(task.id, "Issue closed", closedBy));
        }
        const closedIssue = yield* issues.close(issue.id);
        return { issue: closedIssue, abandonedTasks: abandoned };
      })
    );

    return result;
  });
}

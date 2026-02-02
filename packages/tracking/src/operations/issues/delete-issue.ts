/**
 * deleteIssue - Soft-delete a PLANNED issue with full cleanup
 *
 * Only PLANNED issues can be deleted. Once work has begun, use closeIssue instead.
 * Performs cascading cleanup:
 * - Worktree and branch removal for all tasks
 * - External issue closure (provider handles sync check)
 * - Dispatch queue cleanup
 * - Cascade soft-delete of all tasks
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import { GitWorktreeServiceTag } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const DeleteIssueSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
  deletedBy: z.string().optional().default("system"),
});
export type DeleteIssueInput = z.infer<typeof DeleteIssueSchema>;

export interface DeleteIssueResult {
  issue: Issue;
  deletedTaskCount: number;
  cleanedUpBranches: string[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Soft-delete a PLANNED issue with full cascading cleanup.
 *
 * 1. Validate input and resolve project domain
 * 2. Check issue is in PLANNED status
 * 3. Clean up worktrees and branches for all tasks
 * 4. Close external issues via provider
 * 5. Soft-delete the issue
 * 6. Cascade soft-delete to tasks and clean dispatch queue
 */
export function deleteIssue(input: DeleteIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber, deletedBy } = validateInput(DeleteIssueSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    const issue = yield* pd.issues.getByNumber(issueNumber);
    if (!issue.isInPlanning) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Only PLANNED issues can be deleted. Current status: ${issue.status}. Use close_issue instead.`
        )
      );
    }

    // Get plan and tasks (needed for cleanup)
    const plan = yield* pd.plans.findByIssueId(issue.id);
    const tasks = plan ? yield* pd.tasks.findByPlanId(plan.id) : [];

    const cleanedUpBranches: string[] = [];

    // Clean up worktrees and branches for all tasks
    const gitWorktreeService = yield* GitWorktreeServiceTag;
    if (plan) {
      for (const task of tasks) {
        if (task.worktreePath) {
          // Remove worktree and delete local + remote branches (abandoned work)
          try {
            yield* Effect.promise(() =>
              gitWorktreeService.removeWorktree(task.worktreePath!, true)
            );
            if (task.branchName) {
              cleanedUpBranches.push(task.branchName);
            }
          } catch {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
          }
          // Clear worktree info from task
          yield* pd.tasks.update(task.id, { worktreePath: undefined, branchName: undefined });
        } else if (task.branchName) {
          // No worktree but has branch - delete it
          try {
            yield* Effect.promise(() => gitWorktreeService.run(["branch", "-D", task.branchName!]));
          } catch {
            // Local branch may not exist, ignore
          }

          // Delete remote branch if it exists
          try {
            const checkResult = yield* Effect.promise(() =>
              gitWorktreeService.run(["ls-remote", "--heads", "origin", task.branchName!])
            );
            if (checkResult.success && checkResult.stdout.trim()) {
              yield* Effect.promise(() =>
                gitWorktreeService.run([
                  "push",
                  "origin",
                  "--delete",
                  "--no-verify",
                  task.branchName!,
                ])
              );
              cleanedUpBranches.push(task.branchName!);
            }
          } catch {
            console.warn(`Failed to delete remote branch: ${task.branchName}`);
          }

          // Clear branch info from task
          yield* pd.tasks.update(task.id, { branchName: undefined });
        }
      }
    }

    // Close external issues via provider
    const projectManagement = yield* ProjectManagementService;
    for (const task of tasks) {
      if (task.syncState?.externalId) {
        yield* projectManagement.closeIssue(task.syncState);
      }
    }
    if (issue.syncState?.externalId) {
      yield* projectManagement.closeIssue(issue.syncState);
    }

    // Soft-delete the issue
    const deleted = yield* pd.issues.delete(issue.id, deletedBy);

    // Cascade soft-delete to all tasks and clean up dispatch queue
    const workerQueueDb = yield* WorkerQueueDbTag;
    let deletedTaskCount = 0;
    for (const task of tasks) {
      // Remove from dispatch queue (if present)
      workerQueueDb.remove(task.id);

      // Soft-delete the task
      try {
        yield* pd.tasks.softDelete(task.id, deletedBy);
        deletedTaskCount++;
      } catch {
        // Task may already be deleted or in a non-deletable state
        console.warn(`Could not soft-delete task ${task.id}`);
      }
    }

    return {
      issue: deleted,
      deletedTaskCount,
      cleanedUpBranches,
    } satisfies DeleteIssueResult;
  });
}

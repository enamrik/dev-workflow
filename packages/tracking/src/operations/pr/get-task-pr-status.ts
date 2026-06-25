/**
 * getTaskPRStatus - Get the PR status for a task
 *
 * Fetches fresh PR data from GitHub and updates cached status.
 * Falls back to cached info if GitHub is unreachable.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { GitHubCLI } from "@dev-workflow/git/github/github-cli.js";
import type { PRStatus } from "../../domain/tasks/task.js";
import { validateInput } from "../validation.js";
import { EntityNotFoundError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetTaskPRStatusSchema = z.object({
  taskId: z.string().min(1),
});

export type GetTaskPRStatusInput = z.infer<typeof GetTaskPRStatusSchema>;

export interface GetTaskPRStatusResult {
  hasPR: boolean;
  pr?: {
    number: number;
    url?: string | null;
    title?: string;
    state?: "OPEN" | "CLOSED" | "MERGED";
    status?: PRStatus | null;
    isDraft?: boolean;
    merged?: boolean;
    headBranch?: string;
    baseBranch?: string;
  };
  message?: string;
  cached?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function mapGitHubStateToPRStatus(state: "OPEN" | "CLOSED" | "MERGED", isDraft: boolean): PRStatus {
  if (state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  if (isDraft) return "DRAFT";
  return "OPEN";
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get the PR status for a task.
 *
 * 1. Validate input and resolve services
 * 2. Find task by ID
 * 3. If no PR, return early
 * 4. Fetch fresh PR data from GitHub
 * 5. Update cached status if changed
 * 6. Return PR details (or cached info on error)
 */
export function getTaskPRStatus(input: GetTaskPRStatusInput) {
  return Effect.gen(function* () {
    const { taskId } = validateInput(GetTaskPRStatusSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const githubCLI = yield* GitHubCLI;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    if (!task.prNumber) {
      return {
        hasPR: false,
        message: "Task does not have a PR.",
      } satisfies GetTaskPRStatusResult;
    }

    try {
      const pr = yield* githubCLI.getPR(task.prNumber!);

      if (!pr) {
        return {
          hasPR: true,
          pr: {
            number: task.prNumber!,
            url: task.prUrl,
            status: task.prStatus,
          },
          message: "PR not found on GitHub. Showing cached info.",
          cached: true,
        } satisfies GetTaskPRStatusResult;
      }

      // Update cached status if changed
      const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      if (prStatus !== task.prStatus) {
        yield* taskDomainService.updatePRStatus(taskId, prStatus);
      }

      return {
        hasPR: true,
        pr: {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          state: pr.state,
          status: prStatus,
          isDraft: pr.isDraft,
          merged: pr.merged,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
        },
        cached: false,
      } satisfies GetTaskPRStatusResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        hasPR: true,
        pr: {
          number: task.prNumber!,
          url: task.prUrl,
          status: task.prStatus,
        },
        message: `Could not fetch fresh status: ${message}`,
        cached: true,
      } satisfies GetTaskPRStatusResult;
    }
  });
}

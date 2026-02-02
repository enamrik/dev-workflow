/**
 * createPR - Create a GitHub PR for a task
 *
 * Validates task state, pushes branch to remote, creates PR on GitHub,
 * links to GitHub issues (adds "Closes" or "Part of" links), and
 * updates task with PR metadata.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskService } from "../../domain/tasks/task-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { GitWorktreeServiceTag } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { PRStatus } from "../../domain/tasks/task.js";
import { validateInput } from "../validation.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreatePRSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  draft: z.boolean().optional().default(false),
  baseBranch: z.string().optional(),
  force: z.boolean().optional().default(false),
});

export type CreatePRInput = z.infer<typeof CreatePRSchema>;

export interface CreatePRResult {
  success: boolean;
  adopted?: boolean;
  forced: boolean;
  task: {
    id: string;
    status: string;
  };
  pr: {
    number: number;
    url: string;
    title: string;
    state: "OPEN" | "CLOSED" | "MERGED";
    isDraft: boolean;
    headBranch: string;
    baseBranch: string;
  };
  message: string;
  linkedToTaskGitHubIssue?: string | null;
  linkedToParentGitHubIssue?: string | null;
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
 * Create a PR for a task.
 *
 * 1. Validate input and resolve services
 * 2. Validate task state (IN_PROGRESS, has branch, no existing PR)
 * 3. Check for existing PR on the branch (adopt if found)
 * 4. Get issue info for PR title and linking
 * 5. Push branch to remote
 * 6. Build PR title and body with GitHub issue linking
 * 7. Create PR on GitHub
 * 8. Update task with PR metadata
 */
export function createPR(input: CreatePRInput) {
  return Effect.gen(function* () {
    const { taskId, title, body, draft, baseBranch, force } = validateInput(CreatePRSchema, input);
    const taskService = yield* TaskService;
    const issueService = yield* IssueService;
    const planService = yield* PlanService;
    const githubCLI = yield* GitHubCLITag;
    const gitWorktreeService = yield* GitWorktreeServiceTag;

    const task = yield* Effect.promise(() => taskService.findById(taskId));
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "IN_PROGRESS" && !force) {
      throw new Error(
        `Task must be IN_PROGRESS to create a PR. Current status: ${task.status}. ` +
          "Use force=true to bypass this check if the task state has drifted."
      );
    }

    if (!task.branchName) {
      throw new Error(
        "Task does not have a branch. Task must have been started with a worktree or branch mode."
      );
    }

    if (task.prNumber && !force) {
      throw new Error(
        `Task already has a PR: #${task.prNumber} (${task.prUrl}). ` +
          "Use get_task_pr_status to check its state, or use force=true to create a new PR."
      );
    }

    // Check if a PR already exists for this branch
    try {
      const existingPR = yield* Effect.promise(() => githubCLI.findPRByBranch(task.branchName!));
      if (existingPR) {
        const prStatus = mapGitHubStateToPRStatus(existingPR.state, existingPR.isDraft);
        yield* Effect.promise(() =>
          taskService.updatePRInfo(taskId, existingPR.url, existingPR.number, prStatus)
        );

        return {
          success: true,
          adopted: true,
          forced: force,
          task: {
            id: taskId,
            status: task.status,
          },
          pr: {
            number: existingPR.number,
            url: existingPR.url,
            title: existingPR.title,
            state: existingPR.state,
            isDraft: existingPR.isDraft,
            headBranch: existingPR.headBranch,
            baseBranch: existingPR.baseBranch,
          },
          message:
            `Found existing PR #${existingPR.number} for branch "${task.branchName}". ` +
            `Adopted PR info. Task status unchanged (${task.status}). ` +
            `Use submit_for_review to transition to PR_REVIEW when ready.`,
        } satisfies CreatePRResult;
      }
    } catch {
      // Ignore errors when checking for existing PR
    }

    // Get issue info for PR title and linking
    const plan = yield* Effect.promise(() => planService.findById(task.planId));
    if (!plan) {
      throw new Error(`Plan not found for task: ${taskId}`);
    }

    const issue = yield* issueService.findById(plan.issueId);
    if (!issue) {
      throw new Error(`Issue not found for plan: ${plan.id}`);
    }

    // Push the branch to remote
    try {
      const pushResult = yield* Effect.promise(() =>
        gitWorktreeService.run(
          ["push", "-u", "origin", task.branchName!],
          task.worktreePath ?? undefined
        )
      );
      if (!pushResult.success) {
        throw new Error(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to push branch: ${message}`);
    }

    // Build PR title
    let prTitle: string;
    if (title) {
      prTitle = title;
    } else if (task.syncState?.externalId) {
      prTitle = `[#${task.syncState.externalId}] ${task.title}`;
    } else {
      prTitle = task.title;
    }

    // Build PR body with GitHub issue linking
    let prBody = body ?? task.description;

    const footerLines: string[] = [];
    if (task.syncState?.externalId) {
      footerLines.push(`Closes #${task.syncState.externalId}`);
    }
    if (issue.syncState?.externalId && issue.sourceExternalId) {
      footerLines.push(`Part of #${issue.syncState.externalId}`);
    }

    if (footerLines.length > 0) {
      prBody += "\n\n---\n" + footerLines.join("\n");
    }
    prBody += `\n\nTask ${issue.number}.${task.number}: ${task.title}`;

    const targetBranch = baseBranch ?? "main";

    try {
      const pr = yield* Effect.promise(() =>
        githubCLI.createPR(task.branchName!, targetBranch, prTitle, prBody, draft)
      );

      const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      yield* Effect.promise(() => taskService.updatePRInfo(taskId, pr.url, pr.number, prStatus));

      return {
        success: true,
        forced: force,
        task: {
          id: taskId,
          status: task.status,
        },
        pr: {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          state: pr.state,
          isDraft: pr.isDraft,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
        },
        message:
          `Created PR #${pr.number}: ${pr.url}. ` +
          `Task status unchanged (${task.status}). ` +
          `Use submit_for_review to transition to PR_REVIEW when ready.`,
        linkedToTaskGitHubIssue: task.syncState?.externalId
          ? `#${task.syncState.externalId}`
          : null,
        linkedToParentGitHubIssue: issue.syncState?.externalId
          ? `#${issue.syncState.externalId}`
          : null,
      } satisfies CreatePRResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create PR: ${message}`);
    }
  });
}

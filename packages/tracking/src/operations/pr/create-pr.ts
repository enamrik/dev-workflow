/**
 * createPR - Create a GitHub PR for a task
 *
 * Validates task state, pushes branch to remote, creates PR on GitHub,
 * and updates task with PR metadata.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { GitHubCLI } from "@dev-workflow/git/github/github-cli.js";
import { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { PRStatus } from "../../domain/tasks/task.js";
import { validateInput } from "../validation.js";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";

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
 * 4. Get issue info for PR title
 * 5. Push branch to remote
 * 6. Build PR title and body
 * 7. Create PR on GitHub
 * 8. Update task with PR metadata
 */
export function createPR(input: CreatePRInput) {
  return Effect.gen(function* () {
    const { taskId, title, body, draft, baseBranch, force } = validateInput(CreatePRSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const githubCLI = yield* GitHubCLI;
    const gitWorktreeService = yield* GitWorktreeService;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    if (task.status !== "IN_PROGRESS" && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task must be IN_PROGRESS to create a PR. Current status: ${task.status}. ` +
            "Use force=true to bypass this check if the task state has drifted."
        )
      );
    }

    if (!task.branchName) {
      return yield* Effect.fail(
        new BusinessRuleError(
          "Task does not have a branch. Start the task with load_task_session first."
        )
      );
    }

    if (task.prNumber && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task already has a PR: #${task.prNumber} (${task.prUrl}). ` +
            "Use get_task_pr_status to check its state, or use force=true to create a new PR."
        )
      );
    }

    // Check if a PR already exists for this branch
    try {
      const existingPR = yield* githubCLI.findPRByBranch(task.branchName!);
      if (existingPR) {
        const prStatus = mapGitHubStateToPRStatus(existingPR.state, existingPR.isDraft);
        yield* taskDomainService.updatePRInfo(taskId, existingPR.url, existingPR.number, prStatus);

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

    // Get issue info for PR title
    const plan = yield* planDomainService.findById(task.planId);
    if (!plan) {
      return yield* Effect.fail(new EntityNotFoundError("Plan", task.planId));
    }

    const issue = yield* issueDomainService.findById(plan.issueId);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", plan.issueId));
    }

    // Push the branch to remote
    try {
      const pushResult = yield* gitWorktreeService.run(
        ["push", "-u", "origin", task.branchName!],
        task.worktreePath ?? undefined
      );
      if (!pushResult.success) {
        return yield* Effect.fail(
          new BusinessRuleError(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return yield* Effect.fail(new BusinessRuleError(`Failed to push branch: ${message}`));
    }

    // Build PR title. Every task PR carries a `[#<issue>.<task>]` ref prefix so the
    // PR maps to a specific task at a glance (issue #26) — an issue can have several
    // tasks/PRs, so the issue number alone is ambiguous. We respect an explicit title
    // but guarantee the prefix is present, and default to the task title otherwise.
    // This is the single source of truth for the format; the dfl-worker-task skill and
    // worker prompt tell the worker to pass a matching title, but a forgotten title
    // still gets the ref here. (github-cli passes this title to `gh pr create` verbatim.)
    const taskRef = `[#${issue.number}.${task.number}]`;
    const titleText = title ?? task.title;
    const prTitle = titleText.startsWith(taskRef) ? titleText : `${taskRef} ${titleText}`;

    // Build PR body
    let prBody = body ?? task.description;
    prBody += `\n\nTask ${issue.number}.${task.number}: ${task.title}`;

    const targetBranch = baseBranch ?? "main";

    try {
      const pr = yield* githubCLI.createPR(task.branchName!, targetBranch, prTitle, prBody, draft);

      const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      yield* taskDomainService.updatePRInfo(taskId, pr.url, pr.number, prStatus);

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
      } satisfies CreatePRResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return yield* Effect.fail(new BusinessRuleError(`Failed to create PR: ${message}`));
    }
  });
}

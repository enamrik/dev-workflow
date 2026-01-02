/**
 * PR-related MCP tools
 *
 * Provides GitHub PR integration for task completion workflow.
 */

import {
  type GitHubCLI,
  type GitWorktreeService,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type PRStatus,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

/**
 * Tool definitions for PR operations
 */
export const prToolDefinitions: ToolDefinition[] = [
  {
    name: "get_task_pr_status",
    description:
      "Get the PR status for a task. Returns PR details if one exists.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "submit_for_review",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Submit a task for PR review. Atomically: pushes branch, creates PR, transitions status to PR_REVIEW. " +
      "Task must be IN_PROGRESS with a worktree/branch.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        title: {
          type: "string",
          description: "PR title. Defaults to '[#issueNumber] taskTitle'",
        },
        body: {
          type: "string",
          description: "PR body/description. GitHub issue linking is automatically added.",
        },
        draft: {
          type: "boolean",
          description: "Create as draft PR (default: false)",
        },
        baseBranch: {
          type: "string",
          description: "Target branch for the PR (default: main)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Complete a task after PR is merged. Atomically: verifies PR is merged, pulls main, " +
      "cleans up worktree/branch, transitions status to COMPLETED. " +
      "Task must be in PR_REVIEW status with a merged PR.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        sessionId: {
          type: "string",
          description: "Claude session ID",
        },
      },
      required: ["taskId", "sessionId"],
    },
  },
];

/**
 * Context required for PR tool handlers
 */
export interface PRToolContext {
  githubCLI: GitHubCLI;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  gitWorktreeService?: GitWorktreeService;
}

/**
 * Map GitHub PR state to our PRStatus type
 */
function mapGitHubStateToPRStatus(
  state: "OPEN" | "CLOSED" | "MERGED",
  isDraft: boolean
): PRStatus {
  if (state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  if (isDraft) return "DRAFT";
  return "OPEN";
}

/**
 * Handle get_task_pr_status tool call
 *
 * Gets the current PR status for a task.
 * Uses gh CLI which auto-detects the repository from git remotes.
 */
export async function handleGetTaskPRStatus(
  ctx: PRToolContext,
  args: { taskId: string }
): Promise<ToolResponse> {
  const { taskId } = args;

  // 1. Get task
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (!task.prNumber) {
    return successResponse({
      hasPR: false,
      message: "Task does not have a PR.",
    });
  }

  // 2. Fetch fresh PR status from GitHub (gh CLI auto-detects repo)
  try {
    const pr = await ctx.githubCLI.getPR(task.prNumber);

    if (!pr) {
      return successResponse({
        hasPR: true,
        pr: {
          number: task.prNumber,
          url: task.prUrl,
          status: task.prStatus,
        },
        message: "PR not found on GitHub. Showing cached info.",
        cached: true,
      });
    }

    // Update cached status if changed
    const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
    if (prStatus !== task.prStatus) {
      ctx.taskRepository.updatePRStatus(taskId, prStatus);
    }

    return successResponse({
      hasPR: true,
      pr: {
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: pr.state,
        status: prStatus,
        isDraft: pr.isDraft,
        merged: pr.merged,
        mergeable: pr.mergeable,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
      },
      cached: false,
    });
  } catch (error) {
    // Fall back to cached status on error
    const message = error instanceof Error ? error.message : String(error);
    return successResponse({
      hasPR: true,
      pr: {
        number: task.prNumber,
        url: task.prUrl,
        status: task.prStatus,
      },
      message: `Could not fetch fresh status: ${message}`,
      cached: true,
    });
  }
}

/**
 * Handle submit_for_review tool call
 *
 * Atomically: pushes branch, creates PR, transitions status to PR_REVIEW.
 * Task must be IN_PROGRESS with a worktree/branch.
 */
export async function handleSubmitForReview(
  ctx: PRToolContext,
  args: {
    taskId: string;
    title?: string;
    body?: string;
    draft?: boolean;
    baseBranch?: string;
  }
): Promise<ToolResponse> {
  const { taskId, title, body, draft = false, baseBranch } = args;

  // 1. Get task and validate state
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (task.status !== "IN_PROGRESS") {
    return errorResponse(
      `Task must be IN_PROGRESS to submit for review. Current status: ${task.status}`
    );
  }

  if (!task.branchName) {
    return errorResponse(
      "Task does not have a branch. Task must have been started with a worktree."
    );
  }

  if (task.prNumber) {
    return errorResponse(
      `Task already has a PR: #${task.prNumber} (${task.prUrl}). ` +
      "Use get_task_pr_status to check its state."
    );
  }

  // 2. Get GitHub config
  const config = await ctx.configService.loadConfig();
  if (!config.github?.enabled) {
    return errorResponse(
      "GitHub integration is not enabled. Use update_settings to enable it."
    );
  }

  const { owner, repo } = config.github;

  // 3. Get issue info for PR title and linking
  const plan = ctx.planRepository.findById(task.planId);
  if (!plan) {
    return errorResponse(`Plan not found for task: ${taskId}`);
  }

  const issue = ctx.issueRepository.findById(plan.issueId);
  if (!issue) {
    return errorResponse(`Issue not found for plan: ${plan.id}`);
  }

  // 4. Push the branch to remote (required before creating PR)
  if (ctx.gitWorktreeService) {
    try {
      const pushResult = await ctx.gitWorktreeService.run(
        ["push", "-u", "origin", task.branchName],
        task.worktreePath
      );
      if (!pushResult.success) {
        return errorResponse(
          `Failed to push branch: ${pushResult.stderr || pushResult.stdout}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to push branch: ${message}`);
    }
  } else {
    return errorResponse(
      "GitWorktreeService is required to push branch. Cannot submit for review."
    );
  }

  // 5. Build PR title
  const prTitle = title ?? `[#${issue.number}] ${task.title}`;

  // 6. Build PR body with GitHub issue linking
  let prBody = body ?? task.description;

  // Add "Closes #N" if the issue is synced to GitHub
  if (issue.githubSync?.githubIssueNumber) {
    const closesLine = `\nCloses #${issue.githubSync.githubIssueNumber}`;
    prBody = prBody + "\n\n---\n" + closesLine;
  }

  // Add task reference
  prBody += `\n\n_Task ${issue.number}.${task.number}: ${task.title}_`;

  // 7. Determine base branch
  const targetBranch = baseBranch ?? "main";

  // 8. Create the PR
  try {
    const pr = await ctx.githubCLI.createPR(
      owner,
      repo,
      task.branchName,
      targetBranch,
      prTitle,
      prBody,
      draft
    );

    // 9. Store PR info on task
    const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
    ctx.taskRepository.updatePRInfo(taskId, pr.url, pr.number, prStatus);

    // 10. Update task status to PR_REVIEW
    ctx.taskRepository.updateStatus(taskId, "PR_REVIEW", undefined, "Submitted for review");

    return successResponse({
      success: true,
      task: {
        id: taskId,
        status: "PR_REVIEW",
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
      message: `Created PR #${pr.number} and transitioned task to PR_REVIEW: ${pr.url}`,
      linkedToGitHubIssue: issue.githubSync?.githubIssueNumber
        ? `#${issue.githubSync.githubIssueNumber}`
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to create PR: ${message}`);
  }
}

/**
 * Handle complete_task tool call
 *
 * For tasks with branches (isolated/branch mode):
 * - Verifies PR is merged, pulls main, cleans up worktree/branch
 * - Task must be in PR_REVIEW status with a merged PR
 *
 * For tasks without branches (main mode):
 * - Directly completes the task, skips PR check
 * - Task must be IN_PROGRESS
 */
export async function handleCompleteTask(
  ctx: PRToolContext,
  args: {
    taskId: string;
    sessionId: string;
  }
): Promise<ToolResponse> {
  const { taskId, sessionId } = args;

  // 1. Get task and validate
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Determine mode based on task state
  const hasWorktree = !!task.worktreePath;
  const hasBranch = !!task.branchName;
  const isMainMode = !hasBranch;

  if (isMainMode) {
    // Main mode: skip PR, complete directly from IN_PROGRESS
    if (task.status !== "IN_PROGRESS") {
      return errorResponse(
        `Task must be IN_PROGRESS to complete (main mode). Current status: ${task.status}`
      );
    }

    // Update task status to COMPLETED
    ctx.taskRepository.updateStatus(
      taskId,
      "COMPLETED",
      sessionId,
      "Completed (main mode, no PR)"
    );

    // Clear session association
    ctx.taskRepository.clearSession(taskId);

    return successResponse({
      success: true,
      task: {
        id: taskId,
        status: "COMPLETED",
        mode: "main",
      },
      message: "Task completed (main mode, no PR review).",
    });
  }

  // Branch/Isolated mode: require PR_REVIEW and merged PR
  if (task.status !== "PR_REVIEW") {
    return errorResponse(
      `Task must be in PR_REVIEW status to complete. Current status: ${task.status}. ` +
      "Use submit_for_review first to create a PR."
    );
  }

  if (!task.prNumber) {
    return errorResponse(
      "Task does not have a PR. This is unexpected for a task in PR_REVIEW status."
    );
  }

  // 2. Get GitHub config and verify PR is merged
  const config = await ctx.configService.loadConfig();
  if (!config.github?.enabled) {
    return errorResponse("GitHub integration is not enabled.");
  }

  const { owner, repo } = config.github;

  // 3. Check PR status - must be merged
  const pr = await ctx.githubCLI.getPR(owner, repo, task.prNumber);
  if (!pr) {
    return errorResponse(`PR #${task.prNumber} not found on GitHub.`);
  }

  if (!pr.merged) {
    return errorResponse(
      `PR #${task.prNumber} is not merged yet. Current state: ${pr.state}. ` +
      "Merge the PR on GitHub before completing the task."
    );
  }

  // 4. Pull main to get merged changes
  if (ctx.gitWorktreeService) {
    try {
      // Pull on the main repo (not the worktree)
      const pullResult = await ctx.gitWorktreeService.run(["pull", "origin", "main"]);
      if (!pullResult.success) {
        // Non-fatal: log but continue
        console.warn(`Failed to pull main: ${pullResult.stderr || pullResult.stdout}`);
      }
    } catch {
      // Non-fatal: continue with cleanup
      console.warn("Failed to pull main, continuing with cleanup");
    }

    // 5. Clean up worktree if present (isolated mode)
    if (hasWorktree) {
      try {
        // Remove worktree and delete the branch (merged, no longer needed)
        await ctx.gitWorktreeService.removeWorktree(task.worktreePath!, true);
      } catch {
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }
      // Clear worktree info from task
      ctx.taskRepository.clearWorktreeInfo(taskId);
    } else if (hasBranch) {
      // Branch mode: delete branch and checkout main
      try {
        await ctx.gitWorktreeService.run(["checkout", "main"]);
        await ctx.gitWorktreeService.run(["branch", "-d", task.branchName!]);
      } catch {
        console.warn(`Failed to cleanup branch: ${task.branchName}`);
      }
      // Clear branch info from task
      ctx.taskRepository.update(taskId, { branchName: undefined });
    }
  }

  // 6. Update PR status to MERGED
  ctx.taskRepository.updatePRStatus(taskId, "MERGED");

  // 7. Update task status to COMPLETED
  ctx.taskRepository.updateStatus(
    taskId,
    "COMPLETED",
    sessionId,
    `PR #${task.prNumber} merged`
  );

  // 8. Clear session association
  ctx.taskRepository.clearSession(taskId);

  return successResponse({
    success: true,
    task: {
      id: taskId,
      status: "COMPLETED",
      mode: hasWorktree ? "isolated" : "branch",
    },
    pr: {
      number: task.prNumber,
      url: task.prUrl,
      merged: true,
    },
    message: `Task completed. PR #${task.prNumber} was merged, ${hasWorktree ? "worktree" : "branch"} cleaned up.`,
  });
}

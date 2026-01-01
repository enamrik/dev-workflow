/**
 * PR-related MCP tools
 *
 * Provides GitHub PR integration for task completion workflow.
 */

import {
  type ConfigService,
  type GitHubCLI,
  type GitHubMergeStrategy,
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
    name: "create_task_pr",
    description:
      "Create a GitHub PR for a task. The task must have a worktree with a branch. " +
      "If the issue has a linked GitHub issue, the PR body will include 'Closes #N' to link them.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        title: {
          type: "string",
          description:
            "PR title. If not provided, uses task title prefixed with issue number.",
        },
        body: {
          type: "string",
          description:
            "PR body/description. GitHub issue linking is automatically added.",
        },
        draft: {
          type: "boolean",
          description: "Create as draft PR (default: false)",
        },
        baseBranch: {
          type: "string",
          description:
            "Target branch for the PR (default: main or master)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "merge_task_pr",
    description:
      "Merge a task's PR. The task must have an open PR associated with it.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        strategy: {
          type: "string",
          enum: ["merge", "squash", "rebase"],
          description: "Merge strategy (default: squash)",
        },
        commitTitle: {
          type: "string",
          description: "Custom commit title for squash/merge",
        },
      },
      required: ["taskId"],
    },
  },
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
];

/**
 * Context required for PR tool handlers
 */
export interface PRToolContext {
  configService: ConfigService;
  githubCLI: GitHubCLI;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
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
 * Handle create_task_pr tool call
 *
 * Creates a GitHub PR for the task and stores the PR info on the task.
 */
export async function handleCreateTaskPR(
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

  // 1. Get task and validate it has a branch
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (!task.branchName) {
    return errorResponse(
      "Task does not have a branch. Start the task with createWorktree=true first."
    );
  }

  if (task.prNumber) {
    return errorResponse(
      `Task already has a PR: #${task.prNumber} (${task.prUrl})`
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

  // 4. Build PR title
  const prTitle = title ?? `[#${issue.number}] ${task.title}`;

  // 5. Build PR body with GitHub issue linking
  let prBody = body ?? task.description;

  // Add "Closes #N" if the issue is synced to GitHub
  if (issue.githubSync?.githubIssueNumber) {
    const closesLine = `\nCloses #${issue.githubSync.githubIssueNumber}`;
    prBody = prBody + "\n\n---\n" + closesLine;
  }

  // Add task reference
  prBody += `\n\n_Task ${issue.number}.${task.number}: ${task.title}_`;

  // 6. Determine base branch
  const targetBranch = baseBranch ?? "main";

  // 7. Create the PR
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

    // 8. Store PR info on task
    const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
    ctx.taskRepository.updatePRInfo(taskId, pr.url, pr.number, prStatus);

    return successResponse({
      success: true,
      pr: {
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: pr.state,
        isDraft: pr.isDraft,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
      },
      message: `Created PR #${pr.number}: ${pr.url}`,
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
 * Handle merge_task_pr tool call
 *
 * Merges the task's PR and updates the PR status.
 */
export async function handleMergeTaskPR(
  ctx: PRToolContext,
  args: {
    taskId: string;
    strategy?: GitHubMergeStrategy;
    commitTitle?: string;
  }
): Promise<ToolResponse> {
  const { taskId, strategy = "squash", commitTitle } = args;

  // 1. Get task and validate it has a PR
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (!task.prNumber) {
    return errorResponse("Task does not have a PR. Create one first with create_task_pr.");
  }

  if (task.prStatus === "MERGED") {
    return errorResponse("PR is already merged.");
  }

  if (task.prStatus === "CLOSED") {
    return errorResponse("PR is closed. Cannot merge a closed PR.");
  }

  // 2. Get GitHub config
  const config = await ctx.configService.loadConfig();
  if (!config.github?.enabled) {
    return errorResponse("GitHub integration is not enabled.");
  }

  const { owner, repo } = config.github;

  // 3. Merge the PR
  try {
    const pr = await ctx.githubCLI.mergePR(
      owner,
      repo,
      task.prNumber,
      strategy,
      commitTitle
    );

    // 4. Update PR status on task
    const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
    ctx.taskRepository.updatePRStatus(taskId, prStatus);

    return successResponse({
      success: true,
      pr: {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        merged: pr.merged,
      },
      message: `Merged PR #${pr.number} using ${strategy} strategy`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to merge PR: ${message}`);
  }
}

/**
 * Handle get_task_pr_status tool call
 *
 * Gets the current PR status for a task.
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

  // 2. Get GitHub config
  const config = await ctx.configService.loadConfig();
  if (!config.github?.enabled) {
    // Return cached status if GitHub is disabled
    return successResponse({
      hasPR: true,
      pr: {
        number: task.prNumber,
        url: task.prUrl,
        status: task.prStatus,
      },
      message: "GitHub integration disabled. Showing cached PR info.",
      cached: true,
    });
  }

  const { owner, repo } = config.github;

  // 3. Fetch fresh PR status from GitHub
  try {
    const pr = await ctx.githubCLI.getPR(owner, repo, task.prNumber);

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

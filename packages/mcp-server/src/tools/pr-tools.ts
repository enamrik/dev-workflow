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
  type TaskGitHubSyncService,
  type SqliteDataSource,
  taskExecutionLogs,
  type ClaudeConfigService,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Tool definitions for PR operations
 */
export const prToolDefinitions: ToolDefinition[] = [
  {
    name: "get_task_pr_status",
    description: "Get the PR status for a task. Returns PR details if one exists.",
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
    name: "create_pr",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Create a PR for a task. Pushes branch and creates PR with GitHub issue linking. " +
      "Does NOT change task status (stays IN_PROGRESS). Use submit_for_review afterward to transition to PR_REVIEW. " +
      "Task must be IN_PROGRESS with a worktree/branch. " +
      "Use force=true to bypass status validation when task state has drifted. " +
      "Claude MUST ask user permission before using force=true.",
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
            "PR title. Defaults to '[#N] taskTitle' where N is the task's linked GitHub issue number. Plain 'taskTitle' if task has no GitHub issue.",
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
        force: {
          type: "boolean",
          description:
            "Bypass status validation. Use when task state has drifted " +
            "(e.g., branch already pushed but task not in IN_PROGRESS). " +
            "Claude MUST ask user permission before using force=true.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "submit_for_review",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Submit a task for review. Transitions task status from IN_PROGRESS to PR_REVIEW and syncs to GitHub. " +
      "Task must have a PR created via create_pr first. " +
      "Use force=true to bypass validation when task state has drifted. " +
      "Claude MUST ask user permission before using force=true.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        force: {
          type: "boolean",
          description:
            "Bypass status/PR validation. Use when task state has drifted " +
            "(e.g., task already in PR_REVIEW but needs re-sync). " +
            "Claude MUST ask user permission before using force=true.",
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
      "Task must be in PR_REVIEW status with a merged PR. " +
      "Use force=true to bypass state validation when task state has drifted (e.g., PR already merged but task status is wrong).",
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
        finalLogEntry: {
          type: "string",
          description:
            "Required summary of what was accomplished in this task. " +
            "This is written to the task execution log before completing.",
        },
        force: {
          type: "boolean",
          description:
            "Bypass state machine validation. Use when task state has drifted from reality " +
            "(e.g., task is IN_PROGRESS but PR is already merged). Requires user confirmation before use.",
        },
      },
      required: ["taskId", "sessionId", "finalLogEntry"],
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
  taskGitHubSyncService?: TaskGitHubSyncService;
  /** Required for writing final log entry on task completion */
  dbService: SqliteDataSource;
  taskExecutionLogsSchema: typeof taskExecutionLogs;
  /** Optional service for cleaning up Claude config when worktrees are removed */
  claudeConfigService?: ClaudeConfigService;
}

/**
 * Map GitHub PR state to our PRStatus type
 */
function mapGitHubStateToPRStatus(state: "OPEN" | "CLOSED" | "MERGED", isDraft: boolean): PRStatus {
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
 * Handle create_pr tool call
 *
 * Creates a PR for a task: pushes branch, creates PR with GitHub issue linking.
 * Does NOT change task status (stays IN_PROGRESS).
 *
 * This separation allows GitHub's built-in "Pull request linked to issue" workflow
 * to set the project column to "In progress" without racing with our status sync.
 * Use submit_for_review afterward to transition to PR_REVIEW.
 *
 * When force=true:
 * - Bypasses status validation
 * - Use when task state has drifted (e.g., branch already pushed but task not in IN_PROGRESS)
 */
export async function handleCreatePR(
  ctx: PRToolContext,
  args: {
    taskId: string;
    title?: string;
    body?: string;
    draft?: boolean;
    baseBranch?: string;
    force?: boolean;
  }
): Promise<ToolResponse> {
  const { taskId, title, body, draft = false, baseBranch, force = false } = args;

  // 1. Get task and validate state
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (task.status !== "IN_PROGRESS" && !force) {
    return errorResponse(
      `Task must be IN_PROGRESS to create a PR. Current status: ${task.status}. ` +
        "Use force=true to bypass this check if the task state has drifted."
    );
  }

  if (!task.branchName) {
    return errorResponse(
      "Task does not have a branch. Task must have been started with a worktree or branch mode."
    );
  }

  if (task.prNumber && !force) {
    return errorResponse(
      `Task already has a PR: #${task.prNumber} (${task.prUrl}). ` +
        "Use get_task_pr_status to check its state, or use force=true to create a new PR."
    );
  }

  // 2. Check if a PR already exists for this branch (created outside this tool)
  try {
    const existingPR = await ctx.githubCLI.findPRByBranch(task.branchName);
    if (existingPR) {
      // Adopt the existing PR (but don't change status)
      const prStatus = mapGitHubStateToPRStatus(existingPR.state, existingPR.isDraft);
      ctx.taskRepository.updatePRInfo(taskId, existingPR.url, existingPR.number, prStatus);

      return successResponse({
        success: true,
        adopted: true,
        forced: force,
        task: {
          id: taskId,
          status: task.status, // Status unchanged
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
      });
    }
  } catch {
    // Ignore errors when checking for existing PR, we'll try to create one
  }

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
        return errorResponse(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to push branch: ${message}`);
    }
  } else {
    return errorResponse("GitWorktreeService is required to push branch. Cannot create PR.");
  }

  // 5. Build PR title
  // Use task's GitHub issue number for the prefix (tasks are synced to GitHub issues)
  // Never include dev-workflow issue/task numbers in title - those are internal
  let prTitle: string;
  if (title) {
    prTitle = title;
  } else if (task.githubSync?.githubIssueNumber) {
    // Task has linked GitHub issue - use task's GitHub number
    prTitle = `[#${task.githubSync.githubIssueNumber}] ${task.title}`;
  } else {
    // No GitHub issue linked - use plain title
    prTitle = task.title;
  }

  // 6. Build PR body with GitHub issue linking
  let prBody = body ?? task.description;

  // Build footer with GitHub issue links
  const footerLines: string[] = [];

  // Link to the task's GitHub issue (closes it when PR is merged)
  if (task.githubSync?.githubIssueNumber) {
    footerLines.push(`Closes #${task.githubSync.githubIssueNumber}`);
  }

  // Reference the parent issue for context (without closing it)
  // Only add "Part of" for true sub-issues (where parent was imported from GitHub)
  if (issue.githubSync?.githubIssueNumber && issue.sourceGitHubIssueNumber) {
    footerLines.push(`Part of #${issue.githubSync.githubIssueNumber}`);
  }

  // Add footer with GitHub issue links and dev-workflow task reference
  if (footerLines.length > 0) {
    prBody += "\n\n---\n" + footerLines.join("\n");
  }
  // Add dev-workflow task reference as footer note (not in title to avoid confusing teammates)
  prBody += `\n\nTask ${issue.number}.${task.number}: ${task.title}`;

  // 7. Determine base branch
  const targetBranch = baseBranch ?? "main";

  // 8. Create the PR (gh CLI auto-detects repo from git remotes)
  try {
    const pr = await ctx.githubCLI.createPR(task.branchName, targetBranch, prTitle, prBody, draft);

    // 9. Store PR info on task (but DON'T change status)
    const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
    ctx.taskRepository.updatePRInfo(taskId, pr.url, pr.number, prStatus);

    // NOTE: We intentionally do NOT change task status or sync to GitHub here.
    // This allows GitHub's "Pull request linked to issue" workflow to naturally
    // set the project column to "In progress" without a race condition.
    // Call submit_for_review when ready to transition to PR_REVIEW.

    return successResponse({
      success: true,
      forced: force,
      task: {
        id: taskId,
        status: task.status, // Status unchanged - still IN_PROGRESS
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
      linkedToTaskGitHubIssue: task.githubSync?.githubIssueNumber
        ? `#${task.githubSync.githubIssueNumber}`
        : null,
      linkedToParentGitHubIssue: issue.githubSync?.githubIssueNumber
        ? `#${issue.githubSync.githubIssueNumber}`
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to create PR: ${message}`);
  }
}

/**
 * Handle submit_for_review tool call
 *
 * Transitions task status from IN_PROGRESS to PR_REVIEW and syncs to GitHub.
 * Task must have a PR created via create_pr first.
 *
 * This is the second step of the PR workflow:
 * 1. create_pr - Creates PR, GitHub's workflow sets "In progress"
 * 2. submit_for_review - Transitions to PR_REVIEW, syncs to "In review" column
 *
 * When force=true:
 * - Bypasses status/PR validation
 * - Use when task state has drifted
 */
export async function handleSubmitForReview(
  ctx: PRToolContext,
  args: {
    taskId: string;
    force?: boolean;
  }
): Promise<ToolResponse> {
  const { taskId, force = false } = args;

  // 1. Get task and validate state
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  if (task.status !== "IN_PROGRESS" && !force) {
    return errorResponse(
      `Task must be IN_PROGRESS to submit for review. Current status: ${task.status}. ` +
        "Use force=true to bypass this check if the task state has drifted."
    );
  }

  if (!task.prNumber && !force) {
    return errorResponse(
      "Task does not have a PR. Use create_pr first to create a PR, " +
        "or use force=true to bypass this check."
    );
  }

  // 2. Update task status to PR_REVIEW
  ctx.taskRepository.updateStatus(taskId, "PR_REVIEW", undefined, "Submitted for review");

  // 3. Sync to GitHub if task has GitHub sync enabled
  if (ctx.taskGitHubSyncService && task.githubSync?.githubIssueNumber) {
    try {
      await ctx.taskGitHubSyncService.syncTaskStatus(taskId, "PR_REVIEW");
    } catch (error) {
      // Log but don't fail - GitHub sync is best effort after local update
      console.warn(`Failed to sync task status to GitHub: ${error}`);
    }
  }

  return successResponse({
    success: true,
    forced: force,
    task: {
      id: taskId,
      status: "PR_REVIEW",
    },
    pr: task.prNumber
      ? {
          number: task.prNumber,
          url: task.prUrl,
        }
      : null,
    message: task.prNumber
      ? `Task transitioned to PR_REVIEW. PR #${task.prNumber}: ${task.prUrl}`
      : "Task transitioned to PR_REVIEW (no PR linked).",
  });
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
 *
 * When force=true:
 * - Bypasses state machine validation (status checks)
 * - Still verifies PR is merged for branch/isolated modes (unless no PR exists)
 * - Use when task state has drifted from reality
 *
 * Requires finalLogEntry to document what was accomplished before completing.
 */
export async function handleCompleteTask(
  ctx: PRToolContext,
  args: {
    taskId: string;
    sessionId: string;
    finalLogEntry: string;
    force?: boolean;
  }
): Promise<ToolResponse> {
  const { taskId, sessionId, finalLogEntry, force = false } = args;

  // Validate finalLogEntry is provided and not empty
  if (!finalLogEntry || finalLogEntry.trim().length === 0) {
    return errorResponse(
      "finalLogEntry is required. Please provide a summary of what was accomplished in this task."
    );
  }

  // 1. Get task and validate
  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // 2. Write the final log entry before completing
  const db = ctx.dbService.getDb();
  const logId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(ctx.taskExecutionLogsSchema)
    .values({
      id: logId,
      taskId,
      sessionId,
      message: finalLogEntry.trim(),
      filesModified: null,
      createdAt: now,
    })
    .run();

  // Determine mode based on task state
  const hasWorktree = !!task.worktreePath;
  const hasBranch = !!task.branchName;
  const isMainMode = !hasBranch;

  if (isMainMode) {
    // Main mode: skip PR, complete directly from IN_PROGRESS
    if (task.status !== "IN_PROGRESS" && !force) {
      return errorResponse(
        `Task must be IN_PROGRESS to complete (main mode). Current status: ${task.status}. ` +
          "Use force=true to bypass this check if the task state has drifted."
      );
    }

    // Update task status to COMPLETED
    ctx.taskRepository.updateStatus(taskId, "COMPLETED", sessionId, "Completed (main mode, no PR)");

    // Clear session association
    ctx.taskRepository.clearSession(taskId);

    // Sync to GitHub if task has GitHub sync enabled
    if (ctx.taskGitHubSyncService && task.githubSync?.githubIssueNumber) {
      try {
        await ctx.taskGitHubSyncService.syncTaskStatus(taskId, "COMPLETED");
      } catch (error) {
        // Log but don't fail - GitHub sync is best effort after local update
        console.warn(`Failed to sync task status to GitHub: ${error}`);
      }
    }

    // Find next available task
    const nextTask = findNextAvailableTask(ctx, task.planId);

    return successResponse({
      success: true,
      task: {
        id: taskId,
        status: "COMPLETED",
        mode: "main",
      },
      nextTask,
      message: "Task completed (main mode, no PR review).",
    });
  }

  // Branch/Isolated mode: require PR_REVIEW and merged PR
  if (task.status !== "PR_REVIEW" && !force) {
    return errorResponse(
      `Task must be in PR_REVIEW status to complete. Current status: ${task.status}. ` +
        "Use submit_for_review first to create a PR, or use force=true to bypass this check."
    );
  }

  // If no PR exists and not forcing, error out
  if (!task.prNumber && !force) {
    return errorResponse(
      "Task does not have a PR. Use submit_for_review first to create a PR, " +
        "or use force=true to complete without PR verification."
    );
  }

  // 2. Check PR status - must be merged (gh CLI auto-detects repo)
  // Skip PR verification entirely if force=true and no PR exists
  let prMerged = false;
  if (task.prNumber) {
    const pr = await ctx.githubCLI.getPR(task.prNumber);
    if (!pr) {
      if (!force) {
        return errorResponse(`PR #${task.prNumber} not found on GitHub.`);
      }
      // Force mode: continue without PR verification
    } else if (!pr.merged) {
      if (!force) {
        return errorResponse(
          `PR #${task.prNumber} is not merged yet. Current state: ${pr.state}. ` +
            "Merge the PR on GitHub before completing the task, or use force=true to bypass."
        );
      }
      // Force mode: continue even if PR is not merged
    } else {
      prMerged = true;
    }
  }

  // 3. Pull main to get merged changes
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

    // 4. Clean up worktree if present (isolated mode)
    if (hasWorktree) {
      try {
        // Remove worktree and delete the branch (merged, no longer needed)
        await ctx.gitWorktreeService.removeWorktree(task.worktreePath!, true);
      } catch {
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }

      // 4a. Clean up Claude config folder registration (non-fatal)
      if (ctx.claudeConfigService) {
        try {
          const result = await ctx.claudeConfigService.removeFolder(task.worktreePath!);
          if (result.folderRemoved) {
            console.log(`Cleaned up Claude config: ${result.message}`);
          }
        } catch {
          // Non-fatal: log but don't fail task completion
          console.warn(`Failed to cleanup Claude config for worktree: ${task.worktreePath}`);
        }
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

  // 5. Update PR status to MERGED (only if PR was actually merged)
  if (prMerged && task.prNumber) {
    ctx.taskRepository.updatePRStatus(taskId, "MERGED");
  }

  // 6. Update task status to COMPLETED
  const completionNote = force
    ? `Force completed${task.prNumber ? ` (PR #${task.prNumber})` : ""}`
    : `PR #${task.prNumber} merged`;
  ctx.taskRepository.updateStatus(taskId, "COMPLETED", sessionId, completionNote);

  // 7. Clear session association
  ctx.taskRepository.clearSession(taskId);

  // 8. Sync to GitHub if task has GitHub sync enabled
  if (ctx.taskGitHubSyncService && task.githubSync?.githubIssueNumber) {
    try {
      await ctx.taskGitHubSyncService.syncTaskStatus(taskId, "COMPLETED");
    } catch (error) {
      // Log but don't fail - GitHub sync is best effort after local update
      console.warn(`Failed to sync task status to GitHub: ${error}`);
    }
  }

  // 9. Find next available task
  const nextTask = findNextAvailableTask(ctx, task.planId);

  const message = force
    ? `Task force-completed.${task.prNumber ? ` PR #${task.prNumber} status: ${prMerged ? "merged" : "not verified"}.` : ""} ${hasWorktree ? "Worktree" : "Branch"} cleaned up.`
    : `Task completed. PR #${task.prNumber} was merged, ${hasWorktree ? "worktree" : "branch"} cleaned up.`;

  return successResponse({
    success: true,
    task: {
      id: taskId,
      status: "COMPLETED",
      mode: hasWorktree ? "isolated" : "branch",
    },
    pr: task.prNumber
      ? {
          number: task.prNumber,
          url: task.prUrl,
          merged: prMerged,
        }
      : undefined,
    nextTask,
    forced: force,
    message,
  });
}

/**
 * Find the next available task to work on
 *
 * Priority: READY tasks in same plan, then BACKLOG in same plan,
 * then READY tasks from other plans.
 */
function findNextAvailableTask(
  ctx: PRToolContext,
  currentPlanId: string
): {
  id: string;
  number: number;
  title: string;
  issueNumber: number;
  issueTitle: string;
  status: string;
} | null {
  // First, check same plan for READY tasks
  const samePlanTasks = ctx.taskRepository.findByPlanId(currentPlanId);
  const readyTask = samePlanTasks.find((t) => t.status === "READY");
  if (readyTask) {
    const plan = ctx.planRepository.findById(currentPlanId);
    const issue = plan ? ctx.issueRepository.findById(plan.issueId) : null;
    return {
      id: readyTask.id,
      number: readyTask.number,
      title: readyTask.title,
      issueNumber: issue?.number ?? 0,
      issueTitle: issue?.title ?? "Unknown",
      status: readyTask.status,
    };
  }

  // Check same plan for BACKLOG tasks
  const backlogTask = samePlanTasks.find((t) => t.status === "BACKLOG");
  if (backlogTask) {
    const plan = ctx.planRepository.findById(currentPlanId);
    const issue = plan ? ctx.issueRepository.findById(plan.issueId) : null;
    return {
      id: backlogTask.id,
      number: backlogTask.number,
      title: backlogTask.title,
      issueNumber: issue?.number ?? 0,
      issueTitle: issue?.title ?? "Unknown",
      status: backlogTask.status,
    };
  }

  // Look for READY tasks in other active issues
  const activeIssues = ctx.issueRepository
    .findMany()
    .filter((i) => i.status === "IN_PROGRESS" || i.status === "OPEN");

  for (const issue of activeIssues) {
    const plan = ctx.planRepository.findByIssueId(issue.id);
    if (!plan || plan.id === currentPlanId) continue;

    const tasks = ctx.taskRepository.findByPlanId(plan.id);
    const availableTask = tasks.find((t) => t.status === "READY" || t.status === "BACKLOG");
    if (availableTask) {
      return {
        id: availableTask.id,
        number: availableTask.number,
        title: availableTask.title,
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: availableTask.status,
      };
    }
  }

  return null;
}

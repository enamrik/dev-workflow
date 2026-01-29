/**
 * PRTool - GitHub PR operations for task completion workflow
 *
 * Provides PR creation, status tracking, and task completion with PR verification.
 */

import {
  isIssueClosed,
  isIssueInPlanning,
  isWorkable,
  isActive,
  type PRStatus,
  type IssueService,
  type TaskService,
  type PlanService,
  type GitHubCLI,
  type DbClient,
} from "@dev-workflow/tracking";
import type { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";

// =============================================================================
// Types
// =============================================================================

export interface GetTaskPRStatusInput {
  taskId: string;
}

export interface CreatePRInput {
  taskId: string;
  title?: string;
  body?: string;
  draft?: boolean;
  baseBranch?: string;
  force?: boolean;
}

export interface SubmitForReviewInput {
  taskId: string;
  force?: boolean;
}

export interface CompleteTaskInput {
  taskId: string;
  sessionId: string;
  finalLogEntry: string;
  force?: boolean;
  autoCloseIssue?: boolean;
}

// =============================================================================
// PRTool Class
// =============================================================================

export class PRTool {
  constructor(
    private readonly githubCLI: GitHubCLI,
    private readonly issueService: IssueService,
    private readonly planService: PlanService,
    private readonly taskService: TaskService,
    private readonly gitWorktreeService: GitWorktreeService | null,
    private readonly dbClient: DbClient
  ) {}

  /**
   * Get the PR status for a task.
   */
  async getTaskPRStatus(input: GetTaskPRStatusInput) {
    const { taskId } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!task.prNumber) {
      return {
        hasPR: false,
        message: "Task does not have a PR.",
      };
    }

    try {
      const pr = await this.githubCLI.getPR(task.prNumber);

      if (!pr) {
        return {
          hasPR: true,
          pr: {
            number: task.prNumber,
            url: task.prUrl,
            status: task.prStatus,
          },
          message: "PR not found on GitHub. Showing cached info.",
          cached: true,
        };
      }

      // Update cached status if changed
      const prStatus = this.mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      if (prStatus !== task.prStatus) {
        this.taskService.updatePRStatus(taskId, prStatus);
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
          mergeable: pr.mergeable,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
        },
        cached: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        hasPR: true,
        pr: {
          number: task.prNumber,
          url: task.prUrl,
          status: task.prStatus,
        },
        message: `Could not fetch fresh status: ${message}`,
        cached: true,
      };
    }
  }

  /**
   * Create a PR for a task.
   */
  async createPR(input: CreatePRInput) {
    const { taskId, title, body, draft = false, baseBranch, force = false } = input;

    const task = this.taskService.findById(taskId);
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
      const existingPR = await this.githubCLI.findPRByBranch(task.branchName);
      if (existingPR) {
        const prStatus = this.mapGitHubStateToPRStatus(existingPR.state, existingPR.isDraft);
        this.taskService.updatePRInfo(taskId, existingPR.url, existingPR.number, prStatus);

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
        };
      }
    } catch {
      // Ignore errors when checking for existing PR
    }

    // Get issue info for PR title and linking
    const plan = this.planService.findById(task.planId);
    if (!plan) {
      throw new Error(`Plan not found for task: ${taskId}`);
    }

    const issue = this.issueService.findById(plan.issueId);
    if (!issue) {
      throw new Error(`Issue not found for plan: ${plan.id}`);
    }

    // Push the branch to remote
    if (this.gitWorktreeService) {
      try {
        const pushResult = await this.gitWorktreeService.run(
          ["push", "-u", "origin", task.branchName],
          task.worktreePath
        );
        if (!pushResult.success) {
          throw new Error(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to push branch: ${message}`);
      }
    } else {
      throw new Error("GitWorktreeService is required to push branch. Cannot create PR.");
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
      const pr = await this.githubCLI.createPR(
        task.branchName,
        targetBranch,
        prTitle,
        prBody,
        draft
      );

      const prStatus = this.mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      this.taskService.updatePRInfo(taskId, pr.url, pr.number, prStatus);

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
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create PR: ${message}`);
    }
  }

  /**
   * Submit a task for review.
   */
  async submitForReview(input: SubmitForReviewInput) {
    const { taskId, force = false } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "IN_PROGRESS" && !force) {
      throw new Error(
        `Task must be IN_PROGRESS to submit for review. Current status: ${task.status}. ` +
          "Use force=true to bypass this check if the task state has drifted."
      );
    }

    if (!task.prNumber && !force) {
      throw new Error(
        "Task does not have a PR. Use create_pr first to create a PR, " +
          "or use force=true to bypass this check."
      );
    }

    // Update task status to PR_REVIEW (includes GitHub sync)
    await this.taskService.submitForReview(taskId, { force });

    return {
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
    };
  }

  /**
   * Complete a task after PR is merged.
   */
  async completeTask(input: CompleteTaskInput) {
    const { taskId, sessionId, finalLogEntry, force = false, autoCloseIssue = false } = input;

    // Validate finalLogEntry
    if (!finalLogEntry || finalLogEntry.trim().length === 0) {
      throw new Error(
        "finalLogEntry is required. Please provide a summary of what was accomplished in this task."
      );
    }

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Write the final log entry
    this.dbClient.executionLogs.create({
      taskId,
      sessionId,
      message: finalLogEntry.trim(),
    });

    const hasWorktree = !!task.worktreePath;
    const hasBranch = !!task.branchName;
    const isMainMode = !hasBranch;

    if (isMainMode) {
      return this.completeMainModeTask(task, taskId, sessionId, force, autoCloseIssue);
    }

    return this.completeBranchModeTask(
      task,
      taskId,
      sessionId,
      force,
      autoCloseIssue,
      hasWorktree,
      hasBranch
    );
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private async completeMainModeTask(
    task: ReturnType<TaskService["findById"]>,
    taskId: string,
    sessionId: string,
    force: boolean,
    autoCloseIssue: boolean
  ) {
    if (task!.status !== "IN_PROGRESS" && !force) {
      throw new Error(
        `Task must be IN_PROGRESS to complete (main mode). Current status: ${task!.status}. ` +
          "Use force=true to bypass this check if the task state has drifted."
      );
    }

    // Complete task (includes GitHub sync)
    await this.taskService.complete(taskId, {
      changedBy: sessionId,
      notes: "Completed (main mode, no PR)",
      force,
    });
    this.taskService.clearSession(taskId);

    const issueStatus = await this.checkAndMaybeCloseIssue(task!.planId, autoCloseIssue);
    const nextTask = this.findNextAvailableTask(task!.planId);

    let message = "Task completed (main mode, no PR review).";
    if (issueStatus.issueClosed) {
      message += ` Issue #${issueStatus.issueNumber} has been closed.`;
    }

    return {
      success: true,
      task: {
        id: taskId,
        status: "COMPLETED",
        mode: "main",
      },
      nextTask,
      allTasksComplete: issueStatus.allTasksComplete,
      issueClosed: issueStatus.issueClosed,
      issueNumber: issueStatus.issueNumber,
      message,
    };
  }

  private async completeBranchModeTask(
    task: NonNullable<ReturnType<TaskService["findById"]>>,
    taskId: string,
    sessionId: string,
    force: boolean,
    autoCloseIssue: boolean,
    hasWorktree: boolean,
    hasBranch: boolean
  ) {
    if (task.status !== "PR_REVIEW" && !force) {
      throw new Error(
        `Task must be in PR_REVIEW status to complete. Current status: ${task.status}. ` +
          "Use submit_for_review first to create a PR, or use force=true to bypass this check."
      );
    }

    if (!task.prNumber && !force) {
      throw new Error(
        "Task does not have a PR. Use submit_for_review first to create a PR, " +
          "or use force=true to complete without PR verification."
      );
    }

    // Check PR status - must be merged
    let prMerged = false;
    if (task.prNumber) {
      const pr = await this.githubCLI.getPR(task.prNumber);
      if (!pr) {
        if (!force) {
          throw new Error(`PR #${task.prNumber} not found on GitHub.`);
        }
      } else if (!pr.merged) {
        throw new Error(
          `PR #${task.prNumber} is not merged yet. Current state: ${pr.state}. ` +
            "Merge the PR on GitHub before completing the task. " +
            "Note: force=true cannot bypass this check because the PR is confirmed unmerged."
        );
      } else {
        prMerged = true;
      }
    }

    // Pull main and cleanup
    if (this.gitWorktreeService) {
      try {
        const pullResult = await this.gitWorktreeService.run(["pull", "origin", "main"]);
        if (!pullResult.success) {
          console.warn(`Failed to pull main: ${pullResult.stderr || pullResult.stdout}`);
        }
      } catch {
        console.warn("Failed to pull main, continuing with cleanup");
      }

      if (hasWorktree) {
        try {
          await this.gitWorktreeService.removeWorktree(task.worktreePath!, true);
        } catch {
          console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
        }
        this.taskService.clearWorktreeInfo(taskId);
      } else if (hasBranch) {
        try {
          await this.gitWorktreeService.run(["checkout", "main"]);
          await this.gitWorktreeService.run(["branch", "-d", task.branchName!]);
        } catch {
          console.warn(`Failed to cleanup branch: ${task.branchName}`);
        }
        this.taskService.update(taskId, { branchName: undefined });
      }
    }

    if (prMerged && task.prNumber) {
      this.taskService.updatePRStatus(taskId, "MERGED");
    }

    const completionNote = force
      ? `Force completed${task.prNumber ? ` (PR #${task.prNumber})` : ""}`
      : `PR #${task.prNumber} merged`;
    // Complete task (includes GitHub sync)
    await this.taskService.complete(taskId, {
      changedBy: sessionId,
      notes: completionNote,
      force,
    });
    this.taskService.clearSession(taskId);

    const issueStatus = await this.checkAndMaybeCloseIssue(task.planId, autoCloseIssue);
    const nextTask = this.findNextAvailableTask(task.planId);

    let message = force
      ? `Task force-completed.${task.prNumber ? ` PR #${task.prNumber} status: ${prMerged ? "merged" : "not verified"}.` : ""} ${hasWorktree ? "Worktree" : "Branch"} cleaned up.`
      : `Task completed. PR #${task.prNumber} was merged, ${hasWorktree ? "worktree" : "branch"} cleaned up.`;

    if (issueStatus.issueClosed) {
      message += ` Issue #${issueStatus.issueNumber} has been closed.`;
    }

    return {
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
      allTasksComplete: issueStatus.allTasksComplete,
      issueClosed: issueStatus.issueClosed,
      issueNumber: issueStatus.issueNumber,
      forced: force,
      message,
    };
  }

  /**
   * Map GitHub PR state to our PRStatus type
   */
  private mapGitHubStateToPRStatus(
    state: "OPEN" | "CLOSED" | "MERGED",
    isDraft: boolean
  ): PRStatus {
    if (state === "MERGED") return "MERGED";
    if (state === "CLOSED") return "CLOSED";
    if (isDraft) return "DRAFT";
    return "OPEN";
  }

  /**
   * Check if all tasks in a plan are in terminal state and optionally close the parent issue.
   */
  private async checkAndMaybeCloseIssue(
    planId: string,
    autoCloseIssue: boolean
  ): Promise<{ allTasksComplete: boolean; issueClosed: boolean; issueNumber: number | null }> {
    const allTasks = this.taskService.findByPlanId(planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);

    const terminalStatuses = ["COMPLETED", "ABANDONED"];
    const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

    const plan = this.planService.findById(planId);
    if (!plan) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    const issue = this.issueService.findById(plan.issueId);
    if (!issue) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    let issueClosed = false;
    if (autoCloseIssue && allTasksComplete && issue.status !== "CLOSED") {
      await this.issueService.closeIssue(issue.id, true, "claude-code");
      issueClosed = true;
    }

    return { allTasksComplete, issueClosed, issueNumber: issue.number };
  }

  /**
   * Find the next available task to work on.
   */
  private findNextAvailableTask(currentPlanId: string): {
    id: string;
    number: number;
    title: string;
    issueNumber: number;
    issueTitle: string;
    status: string;
  } | null {
    const samePlanTasks = this.taskService.findByPlanId(currentPlanId);
    const readyTask = samePlanTasks.find((t) => t.status === "READY");
    if (readyTask) {
      const plan = this.planService.findById(currentPlanId);
      const issue = plan ? this.issueService.findById(plan.issueId) : null;
      return {
        id: readyTask.id,
        number: readyTask.number,
        title: readyTask.title,
        issueNumber: issue?.number ?? 0,
        issueTitle: issue?.title ?? "Unknown",
        status: readyTask.status,
      };
    }

    const backlogTask = samePlanTasks.find((t) => t.status === "BACKLOG");
    if (backlogTask) {
      const plan = this.planService.findById(currentPlanId);
      const issue = plan ? this.issueService.findById(plan.issueId) : null;
      return {
        id: backlogTask.id,
        number: backlogTask.number,
        title: backlogTask.title,
        issueNumber: issue?.number ?? 0,
        issueTitle: issue?.title ?? "Unknown",
        status: backlogTask.status,
      };
    }

    const activeIssues = this.issueService
      .findMany({})
      .filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i));

    for (const issue of activeIssues) {
      const plan = this.planService.findByIssueId(issue.id);
      if (!plan || plan.id === currentPlanId) continue;

      const tasks = this.taskService.findByPlanId(plan.id);
      const availableTask = tasks.find((t) => isWorkable(t) && !isActive(t));
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
}

/**
 * completeTask - Complete a task after PR merge
 *
 * Multi-path logic: handles main mode (no branch/PR) and branch mode
 * (worktree or branch with PR verification). Validates PR merged status,
 * cleans up worktrees/branches, writes execution log, and optionally
 * closes the parent issue.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskService } from "../../domain/tasks/task-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { DbClientTag } from "../../data-access/db-client.js";
import type { GitHubCLI } from "../../project-sync/github/github-cli.js";
import type { Task } from "../../domain/tasks/task.js";
import { validateInput } from "../validation.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const CompleteTaskSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  finalLogEntry: z.string().trim().min(1, {
    message:
      "finalLogEntry is required. Please provide a summary of what was accomplished in this task.",
  }),
  force: z.boolean().optional().default(false),
  autoCloseIssue: z.boolean().optional().default(false),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

interface NextTaskInfo {
  id: string;
  number: number;
  title: string;
  issueNumber: number;
  issueTitle: string;
  status: string;
}

export interface CompleteTaskResult {
  success: boolean;
  task: {
    id: string;
    status: string;
    mode: "main" | "isolated" | "branch";
  };
  pr?: {
    number: number;
    url: string | undefined;
    merged: boolean;
  };
  nextTask: NextTaskInfo | null;
  allTasksComplete: boolean;
  issueClosed: boolean;
  issueNumber: number | null;
  forced?: boolean;
  message: string;
}

// =============================================================================
// Helpers
// =============================================================================

function checkAndMaybeCloseIssue(
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService,
  planId: string,
  autoCloseIssue: boolean
) {
  return Effect.gen(function* () {
    const allTasks = yield* taskService.findByPlanId(planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);

    const allTasksComplete = activeTasks.every((t) => t.isTerminal);

    const plan = yield* planService.findById(planId);
    if (!plan) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    const issue = yield* issueService.findById(plan.issueId);
    if (!issue) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    let issueClosed = false;
    if (autoCloseIssue && allTasksComplete && issue.status !== "CLOSED") {
      yield* issueService.closeIssue(issue.id, true, "claude-code");
      issueClosed = true;
    }

    return { allTasksComplete, issueClosed, issueNumber: issue.number };
  });
}

function findNextAvailableTask(
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService,
  currentPlanId: string
) {
  return Effect.gen(function* () {
    // Check same plan first
    const samePlanTasks = yield* taskService.findByPlanId(currentPlanId);
    const readyTask = samePlanTasks.find((t) => t.status === "READY");
    if (readyTask) {
      const plan = yield* planService.findById(currentPlanId);
      const issue = plan ? yield* issueService.findById(plan.issueId) : null;
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
      const plan = yield* planService.findById(currentPlanId);
      const issue = plan ? yield* issueService.findById(plan.issueId) : null;
      return {
        id: backlogTask.id,
        number: backlogTask.number,
        title: backlogTask.title,
        issueNumber: issue?.number ?? 0,
        issueTitle: issue?.title ?? "Unknown",
        status: backlogTask.status,
      };
    }

    // Check other active issues
    const allIssues = yield* issueService.findMany({});
    const activeIssues = allIssues.filter((i) => !i.isClosed && !i.isInPlanning);

    for (const issue of activeIssues) {
      const plan = yield* planService.findByIssueId(issue.id);
      if (!plan || plan.id === currentPlanId) continue;

      const tasks = yield* taskService.findByPlanId(plan.id);
      const availableTask = tasks.find((t) => t.isWorkable && !t.isActive);
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
  });
}

function completeMainModeTask(
  task: Task,
  taskId: string,
  sessionId: string,
  force: boolean,
  autoCloseIssue: boolean,
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService
) {
  return Effect.gen(function* () {
    if (task.status !== "IN_PROGRESS" && !force) {
      throw new Error(
        `Task must be IN_PROGRESS to complete (main mode). Current status: ${task.status}. ` +
          "Use force=true to bypass this check if the task state has drifted."
      );
    }

    // Complete task (includes GitHub sync)
    yield* taskService.complete(taskId, {
      changedBy: sessionId,
      notes: "Completed (main mode, no PR)",
      force,
    });
    yield* taskService.clearSession(taskId);

    const issueStatus = yield* checkAndMaybeCloseIssue(
      taskService,
      planService,
      issueService,
      task.planId,
      autoCloseIssue
    );
    const nextTask = yield* findNextAvailableTask(
      taskService,
      planService,
      issueService,
      task.planId
    );

    let message = "Task completed (main mode, no PR review).";
    if (issueStatus.issueClosed) {
      message += ` Issue #${issueStatus.issueNumber} has been closed.`;
    }

    return {
      success: true,
      task: {
        id: taskId,
        status: "COMPLETED",
        mode: "main" as const,
      },
      nextTask,
      allTasksComplete: issueStatus.allTasksComplete,
      issueClosed: issueStatus.issueClosed,
      issueNumber: issueStatus.issueNumber,
      message,
    } satisfies CompleteTaskResult;
  });
}

function completeBranchModeTask(
  task: Task,
  taskId: string,
  sessionId: string,
  force: boolean,
  autoCloseIssue: boolean,
  hasWorktree: boolean,
  hasBranch: boolean,
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService,
  githubCLI: GitHubCLI,
  gitWorktreeService: GitWorktreeService
) {
  return Effect.gen(function* () {
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
      const pr = yield* githubCLI.getPR(task.prNumber);
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
    try {
      const pullResult = yield* gitWorktreeService.run(["pull", "origin", "main"]);
      if (!pullResult.success) {
        console.warn(`Failed to pull main: ${pullResult.stderr || pullResult.stdout}`);
      }
    } catch {
      console.warn("Failed to pull main, continuing with cleanup");
    }

    if (hasWorktree) {
      try {
        yield* gitWorktreeService.removeWorktree(task.worktreePath!, true);
      } catch {
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }
      yield* taskService.clearWorktreeInfo(taskId);
    } else if (hasBranch) {
      try {
        yield* gitWorktreeService.run(["checkout", "main"]);
        yield* gitWorktreeService.run(["branch", "-d", task.branchName!]);
      } catch {
        console.warn(`Failed to cleanup branch: ${task.branchName}`);
      }
      yield* taskService.update(taskId, { branchName: undefined });
    }

    if (prMerged && task.prNumber) {
      yield* taskService.updatePRStatus(taskId, "MERGED");
    }

    const completionNote = force
      ? `Force completed${task.prNumber ? ` (PR #${task.prNumber})` : ""}`
      : `PR #${task.prNumber} merged`;
    // Complete task (includes GitHub sync)
    yield* taskService.complete(taskId, {
      changedBy: sessionId,
      notes: completionNote,
      force,
    });
    yield* taskService.clearSession(taskId);

    const issueStatus = yield* checkAndMaybeCloseIssue(
      taskService,
      planService,
      issueService,
      task.planId,
      autoCloseIssue
    );
    const nextTask = yield* findNextAvailableTask(
      taskService,
      planService,
      issueService,
      task.planId
    );

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
    } satisfies CompleteTaskResult;
  });
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Complete a task after PR is merged.
 *
 * 1. Validate input and resolve services
 * 2. Find task and write final execution log entry
 * 3. Determine mode (main vs branch)
 * 4. Main mode: validate IN_PROGRESS, complete directly
 * 5. Branch mode: verify PR merged, cleanup worktree/branch, complete
 * 6. Optionally close parent issue if all tasks terminal
 * 7. Find next available task
 */
export function completeTask(input: CompleteTaskInput) {
  return Effect.gen(function* () {
    const { taskId, sessionId, finalLogEntry, force, autoCloseIssue } = validateInput(
      CompleteTaskSchema,
      input
    );
    const taskService = yield* TaskService;
    const issueService = yield* IssueService;
    const planService = yield* PlanService;
    const githubCLI = yield* GitHubCLITag;
    const gitWorktreeService = yield* GitWorktreeService;
    const dbClient = yield* DbClientTag;

    const task = yield* taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Write the final log entry
    yield* dbClient.executionLogs.create({
      taskId,
      sessionId,
      message: finalLogEntry.trim(),
    });

    const hasWorktree = !!task.worktreePath;
    const hasBranch = !!task.branchName;
    const isMainMode = !hasBranch;

    if (isMainMode) {
      return yield* completeMainModeTask(
        task,
        taskId,
        sessionId,
        force,
        autoCloseIssue,
        taskService,
        planService,
        issueService
      );
    }

    return yield* completeBranchModeTask(
      task,
      taskId,
      sessionId,
      force,
      autoCloseIssue,
      hasWorktree,
      hasBranch,
      taskService,
      planService,
      issueService,
      githubCLI,
      gitWorktreeService
    );
  });
}

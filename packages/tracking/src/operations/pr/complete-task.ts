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
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { DbClientTag } from "../../data-access/db-client.js";
import type { GitHubCLI } from "../../project-sync/github/github-cli.js";
import type { Task } from "../../domain/tasks/task.js";
import { validateInput } from "../validation.js";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";

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
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueDomainService: IssueDomainService,
  projectManagement: ProjectManagementService,
  planId: string,
  autoCloseIssue: boolean
) {
  return Effect.gen(function* () {
    const allTasks = yield* taskDomainService.findByPlanId(planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);

    const allTasksComplete = activeTasks.every((t) => t.isTerminal);

    const plan = yield* planDomainService.findById(planId);
    if (!plan) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    const issue = yield* issueDomainService.findById(plan.issueId);
    if (!issue) {
      return { allTasksComplete, issueClosed: false, issueNumber: null };
    }

    let issueClosed = false;
    if (autoCloseIssue && allTasksComplete && issue.status !== "CLOSED") {
      // Abandon incomplete tasks (defensive — should be none since allTasksComplete)
      const incompleteTasks = yield* taskDomainService.getIncompleteTasksForIssue(issue.id);
      for (const t of incompleteTasks) {
        yield* taskDomainService.abandon(t.id, "Issue closed", "claude-code");
      }
      const updatedSync = yield* projectManagement.closeIssue(issue.syncState);
      if (updatedSync) {
        yield* issueDomainService.update(issue.id, { syncState: updatedSync });
      }
      yield* issueDomainService.update(issue.id, { status: "CLOSED" });
      issueClosed = true;
    }

    return { allTasksComplete, issueClosed, issueNumber: issue.number };
  });
}

function findNextAvailableTask(
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueDomainService: IssueDomainService,
  currentPlanId: string
) {
  return Effect.gen(function* () {
    const samePlanTasks = yield* taskDomainService.findByPlanId(currentPlanId);
    const readyTask = samePlanTasks.find((t) => t.status === "READY");
    if (readyTask) {
      const plan = yield* planDomainService.findById(currentPlanId);
      const issue = plan ? yield* issueDomainService.findById(plan.issueId) : null;
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
      const plan = yield* planDomainService.findById(currentPlanId);
      const issue = plan ? yield* issueDomainService.findById(plan.issueId) : null;
      return {
        id: backlogTask.id,
        number: backlogTask.number,
        title: backlogTask.title,
        issueNumber: issue?.number ?? 0,
        issueTitle: issue?.title ?? "Unknown",
        status: backlogTask.status,
      };
    }

    const allIssues = yield* issueDomainService.findMany({});
    const activeIssues = allIssues.filter((i) => !i.isClosed && !i.isInPlanning);

    for (const issue of activeIssues) {
      const plan = yield* planDomainService.findByIssueId(issue.id);
      if (!plan || plan.id === currentPlanId) continue;

      const tasks = yield* taskDomainService.findByPlanId(plan.id);
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
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueDomainService: IssueDomainService,
  projectManagement: ProjectManagementService
) {
  return Effect.gen(function* () {
    if (task.status !== "IN_PROGRESS" && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task must be IN_PROGRESS to complete (main mode). Current status: ${task.status}. ` +
            "Use force=true to bypass this check if the task state has drifted."
        )
      );
    }

    yield* taskDomainService.complete(taskId, {
      changedBy: sessionId,
      notes: "Completed (main mode, no PR)",
      force,
    });

    const closeSyncState = yield* projectManagement.closeIssue(task.syncState);
    if (closeSyncState) {
      yield* taskDomainService.updateSyncState(taskId, closeSyncState);
    }
    const statusSync = yield* projectManagement.syncTaskStatus(
      closeSyncState ?? task.syncState,
      "COMPLETED"
    );
    if (statusSync) {
      yield* taskDomainService.updateSyncState(taskId, statusSync);
    }

    yield* taskDomainService.clearSession(taskId);

    const issueStatus = yield* checkAndMaybeCloseIssue(
      taskDomainService,
      planDomainService,
      issueDomainService,
      projectManagement,
      task.planId,
      autoCloseIssue
    );
    const nextTask = yield* findNextAvailableTask(
      taskDomainService,
      planDomainService,
      issueDomainService,
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
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueDomainService: IssueDomainService,
  projectManagement: ProjectManagementService,
  githubCLI: GitHubCLI,
  gitWorktreeService: GitWorktreeService
) {
  return Effect.gen(function* () {
    if (task.status !== "PR_REVIEW" && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task must be in PR_REVIEW status to complete. Current status: ${task.status}. ` +
            "Use submit_for_review first to create a PR, or use force=true to bypass this check."
        )
      );
    }

    if (!task.prNumber && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          "Task does not have a PR. Use submit_for_review first to create a PR, " +
            "or use force=true to complete without PR verification."
        )
      );
    }

    let prMerged = false;
    if (task.prNumber) {
      const pr = yield* githubCLI.getPR(task.prNumber);
      if (!pr) {
        if (!force) {
          return yield* Effect.fail(new EntityNotFoundError("PR", String(task.prNumber)));
        }
      } else if (!pr.merged) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `PR #${task.prNumber} is not merged yet. Current state: ${pr.state}. ` +
              "Merge the PR on GitHub before completing the task. " +
              "Note: force=true cannot bypass this check because the PR is confirmed unmerged."
          )
        );
      } else {
        prMerged = true;
      }
    }

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
      yield* taskDomainService.clearWorktreeInfo(taskId);
    } else if (hasBranch) {
      try {
        yield* gitWorktreeService.run(["checkout", "main"]);
        yield* gitWorktreeService.run(["branch", "-d", task.branchName!]);
      } catch {
        console.warn(`Failed to cleanup branch: ${task.branchName}`);
      }
      yield* taskDomainService.update(taskId, { branchName: undefined });
    }

    if (prMerged && task.prNumber) {
      yield* taskDomainService.updatePRStatus(taskId, "MERGED");
    }

    const completionNote = force
      ? `Force completed${task.prNumber ? ` (PR #${task.prNumber})` : ""}`
      : `PR #${task.prNumber} merged`;
    yield* taskDomainService.complete(taskId, {
      changedBy: sessionId,
      notes: completionNote,
      force,
    });

    const closeSyncState = yield* projectManagement.closeIssue(task.syncState);
    if (closeSyncState) {
      yield* taskDomainService.updateSyncState(taskId, closeSyncState);
    }
    const statusSync = yield* projectManagement.syncTaskStatus(
      closeSyncState ?? task.syncState,
      "COMPLETED"
    );
    if (statusSync) {
      yield* taskDomainService.updateSyncState(taskId, statusSync);
    }

    yield* taskDomainService.clearSession(taskId);

    const issueStatus = yield* checkAndMaybeCloseIssue(
      taskDomainService,
      planDomainService,
      issueDomainService,
      projectManagement,
      task.planId,
      autoCloseIssue
    );
    const nextTask = yield* findNextAvailableTask(
      taskDomainService,
      planDomainService,
      issueDomainService,
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
    const taskDomainService = yield* TaskDomainService;
    const issueDomainService = yield* IssueDomainService;
    const projectManagement = yield* ProjectManagementService;
    const planDomainService = yield* PlanDomainService;
    const githubCLI = yield* GitHubCLITag;
    const gitWorktreeService = yield* GitWorktreeService;
    const dbClient = yield* DbClientTag;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

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
        taskDomainService,
        planDomainService,
        issueDomainService,
        projectManagement
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
      taskDomainService,
      planDomainService,
      issueDomainService,
      projectManagement,
      githubCLI,
      gitWorktreeService
    );
  });
}

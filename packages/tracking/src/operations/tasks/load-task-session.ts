/**
 * loadTaskSession - Load a task session for execution
 *
 * Idempotent - safe to call multiple times. Handles:
 * - Access control: queued tasks require matching worker
 * - Terminal state detection: returns graceful response for COMPLETED/ABANDONED
 * - Session management: start/resume via TaskDomainService + GitWorktreeService
 * - Conflict detection: warns about files modified by prior tasks
 * - External sync: syncs status and auto-assigns on fresh start
 * - Context enrichment: loads issue, plan, dependencies, dependents
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import {
  ConflictDetectionService,
  type ConflictWarning,
} from "../../conflict-detection-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { TaskDomainService, type TaskSession } from "../../domain/tasks/task-domain-service.js";
import { DependencyNotSatisfiedError } from "../../domain/errors.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import {
  GitWorktreeService,
  generateWorktreeNames,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const loadTaskSessionSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  mode: z.enum(["isolated", "branch", "main"]).optional().default("isolated"),
  workerId: z.string().min(1).optional(),
});

export type LoadTaskSessionInput = z.infer<typeof loadTaskSessionSchema>;

// =============================================================================
// Types
// =============================================================================

export interface LoadTaskSessionResult {
  success: boolean;
  sessionId: string;
  task: Task;
  resumed: boolean;
  startedAt: string;
  worktreePath?: string | null;
  branchName?: string | null;
  conflictWarnings?: ConflictWarning[];
  conflictWarningMessage?: string;
  plan?: unknown;
  issue?: unknown;
  dependencies?: unknown[];
  dependents?: unknown[];
  taskRequirements?: string;
  message?: string;
  // Terminal state fields
  nextTask?: { id: string; number: number; title: string; status: string } | null;
  allTasksComplete?: boolean;
  issueNumber?: number | null;
  issueStatus?: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function formatConflictWarnings(warnings: ConflictWarning[], issueNumber?: number | null): string {
  const lines = ["\u26a0\ufe0f Potential file conflicts detected:"];
  for (const warning of warnings) {
    const modifiers = warning.modifiedBy
      .map((m) => {
        const storyRef =
          issueNumber != null ? `#${issueNumber}.${m.taskNumber}` : `#${m.taskNumber}`;
        return `${storyRef} ${m.taskTitle}`;
      })
      .join(", ");
    lines.push(`  - ${warning.filePath} was modified by: ${modifiers}`);
  }
  lines.push("");
  lines.push("These files were touched by prior tasks. Review carefully when making changes.");
  return lines.join("\n");
}

function formatTaskRequirements(implementationPlan: string): string {
  return "## Task-Specific Instructions\n" + implementationPlan;
}

// =============================================================================
// Operation
// =============================================================================

export function loadTaskSession(input: LoadTaskSessionInput) {
  return Effect.gen(function* () {
    const { taskId, sessionId, mode, workerId } = validateInput(loadTaskSessionSchema, input);
    const taskService = yield* TaskService;
    const taskDomainService = yield* TaskDomainService;
    const planDomainService = yield* PlanDomainService;
    const issueService = yield* IssueService;
    const gitWorktreeService = yield* GitWorktreeService;
    const conflictDetectionService = yield* ConflictDetectionService;
    const workerQueueDb = yield* WorkerQueueDbTag;

    // Check if task exists
    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Access control: queued tasks require worker with matching workerId
    const queueEntry = workerQueueDb?.findByTaskId(taskId) ?? null;
    if (queueEntry) {
      if (!workerId) {
        throw new Error(
          `Task is in dispatch queue and can only be claimed by a worker. ` +
            `Start a worker to continue this task, or remove it from the queue first.`
        );
      }
      if (queueEntry.workerId !== workerId) {
        throw new Error(
          `Task queue mismatch: expected worker ${queueEntry.workerId ?? "(unclaimed)"}, got ${workerId}. ` +
            `The task must be claimed by this worker before loading.`
        );
      }
    }

    // Access control: workers must use isolated mode
    if (workerId && mode !== "isolated") {
      throw new Error(
        `Workers MUST use isolated mode. Got mode="${mode}" with workerId="${workerId}". ` +
          `Workers are not allowed to use branch or main modes.`
      );
    }

    // Terminal states - return gracefully with context (not an error)
    if (task.isTerminal) {
      return yield* buildTerminalStateResponse(
        task,
        taskDomainService,
        planDomainService,
        issueService
      );
    }

    // =========================================================================
    // Inline startTaskSession logic (idempotent fresh start / resume)
    // =========================================================================

    // Determine if this is a fresh start or resume
    const isResume = (task.startedAt !== undefined && task.startedAt !== null) || task.isActive;
    const now = new Date().toISOString();

    // Get issue number for worktree naming
    const taskPlan = yield* planDomainService.findById(task.planId);
    const taskIssue = taskPlan ? yield* issueService.findById(taskPlan.issueId) : null;
    const issueNumber = taskIssue?.number;
    if (!issueNumber) {
      throw new Error(`Could not resolve issue number for task: ${taskId}`);
    }

    // For fresh starts only: validate dependencies and run conflict detection
    let conflictWarnings: ConflictWarning[] | undefined;
    if (!isResume) {
      // Check if dependencies are satisfied
      const depsSatisfied = yield* taskDomainService.areDependenciesSatisfied(task);
      if (!depsSatisfied) {
        const blockingTasks = yield* taskDomainService.getBlockingDependencies(task);
        const blockingDetails: {
          id: string;
          number: number;
          title: string;
          status: string;
          issueNumber: number | null;
        }[] = [];
        for (const t of blockingTasks) {
          const blockingPlan = yield* planDomainService.findById(t.planId);
          const blockingIssue = blockingPlan
            ? yield* issueService.findById(blockingPlan.issueId)
            : null;
          blockingDetails.push({
            id: t.id,
            number: t.number,
            title: t.title,
            status: t.status,
            issueNumber: blockingIssue?.number ?? null,
          });
        }
        throw new DependencyNotSatisfiedError(taskId, task.title, blockingDetails);
      }

      // Run conflict detection (non-blocking)
      try {
        const conflictResult = yield* conflictDetectionService.detectConflicts(taskId);
        if (conflictResult.hasConflicts) {
          conflictWarnings = conflictResult.warnings;
        }
      } catch {
        // Conflict detection failures should not block task start
      }
    }

    // Setup worktree/branch based on execution mode (only if doesn't exist)
    let worktreePath: string | undefined = task.worktreePath;
    let branchName: string | undefined = task.branchName;

    if (mode === "isolated" && !worktreePath) {
      const names = generateWorktreeNames(issueNumber, task.number, task.title);
      branchName = names.branchName;
      worktreePath = yield* Effect.catchAll(
        gitWorktreeService.createWorktree(names.worktreePath, branchName),
        (err) => Effect.promise(() => Promise.reject<string>(err))
      );
      yield* taskDomainService.updateWorktreeInfo(taskId, worktreePath, branchName);
    } else if (mode === "branch" && !branchName) {
      const names = generateWorktreeNames(issueNumber, task.number, task.title);
      branchName = names.branchName;
      yield* gitWorktreeService.run(["checkout", "-b", branchName]);
      yield* taskDomainService.update(taskId, { branchName });
    }
    // mode === "main": no branch, no worktree - work directly on main

    // Only for fresh starts: activate plan and transition status
    if (!isResume) {
      yield* taskDomainService.activatePlan(task.planId, taskId, sessionId);
      yield* taskDomainService.start(taskId, sessionId);
    }

    // Always update session tracking (idempotent)
    yield* taskDomainService.updateSessionInfo(taskId, sessionId, isResume ? undefined : now, now);

    // Get final task state
    const finalTask = yield* taskDomainService.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve updated task: ${taskId}`);
    }

    const sessionResult: TaskSession & { conflictWarnings?: ConflictWarning[] } = {
      task: finalTask,
      sessionId,
      startedAt: finalTask.startedAt ?? now,
      resumed: isResume,
      worktreePath,
      branchName,
      conflictWarnings,
    };

    // =========================================================================
    // Build response
    // =========================================================================

    const response: LoadTaskSessionResult = {
      success: true,
      sessionId,
      task: sessionResult.task,
      resumed: sessionResult.resumed,
      startedAt: sessionResult.startedAt,
    };

    if (sessionResult.worktreePath) {
      response.worktreePath = sessionResult.worktreePath;
      response.branchName = sessionResult.branchName;
    }

    if (sessionResult.conflictWarnings && sessionResult.conflictWarnings.length > 0) {
      response.conflictWarnings = sessionResult.conflictWarnings;
      response.conflictWarningMessage = formatConflictWarnings(
        sessionResult.conflictWarnings,
        taskIssue?.number
      );
    }

    // Sync to external project management provider
    yield* taskService.syncTaskStatus(taskId, sessionResult.task.status);

    // On fresh start only: auto-assign and sync siblings
    if (!sessionResult.resumed) {
      yield* taskService.assignIssue(taskId);

      // Sync sibling tasks that transitioned from BACKLOG to READY
      const siblingTasks = yield* taskDomainService.findByPlanId(sessionResult.task.planId);
      for (const sibling of siblingTasks) {
        if (sibling.id !== taskId && sibling.status === "READY") {
          yield* taskService.syncTaskStatus(sibling.id, "READY");
        }
      }
    }

    // Load full context
    return yield* addTaskContext(
      response,
      sessionResult.task,
      taskDomainService,
      planDomainService,
      issueService
    );
  });
}

// =============================================================================
// Private Helper Functions
// =============================================================================

/**
 * Find the next available task in a plan (READY or BACKLOG).
 */
function findNextAvailableTaskInPlan(planId: string, taskDomainService: TaskDomainService) {
  return Effect.gen(function* () {
    const tasks = yield* taskDomainService.findByPlanId(planId);

    // Prefer READY tasks, then BACKLOG
    const readyTask = tasks.find((t) => t.status === "READY" && !t.isDeleted);
    if (readyTask) {
      return {
        id: readyTask.id,
        number: readyTask.number,
        title: readyTask.title,
        status: readyTask.status,
      };
    }

    const backlogTask = tasks.find((t) => t.status === "BACKLOG" && !t.isDeleted);
    if (backlogTask) {
      return {
        id: backlogTask.id,
        number: backlogTask.number,
        title: backlogTask.title,
        status: backlogTask.status,
      };
    }

    return null;
  });
}

/**
 * Build response for terminal state tasks (COMPLETED/ABANDONED).
 */
function buildTerminalStateResponse(
  task: Task,
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueService: IssueService
) {
  return Effect.gen(function* () {
    // Get issue status
    const plan = yield* planDomainService.findById(task.planId);
    const issue = plan ? yield* issueService.findById(plan.issueId) : null;

    // Check if all tasks are complete
    const allTasks = yield* taskDomainService.findByPlanId(task.planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);
    const terminalStatuses = ["COMPLETED", "ABANDONED"];
    const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

    // Find next available task in the plan
    const nextTask = yield* findNextAvailableTaskInPlan(task.planId, taskDomainService);

    return {
      success: true,
      sessionId: "",
      task,
      resumed: false,
      startedAt: task.startedAt ?? "",
      issue,
      plan,
      // Key fields that signal "no work needed"
      nextTask,
      allTasksComplete,
      issueNumber: issue?.number ?? null,
      issueStatus: issue?.status ?? null,
      message: `Task is already ${task.status}. No work needed.`,
    } satisfies LoadTaskSessionResult;
  });
}

/**
 * Add full task context to response (issue, plan, dependencies).
 */
function addTaskContext(
  response: LoadTaskSessionResult,
  task: Task,
  taskDomainService: TaskDomainService,
  planDomainService: PlanDomainService,
  issueService: IssueService
) {
  return Effect.gen(function* () {
    // Get plan and issue
    const plan = yield* planDomainService.findById(task.planId);
    if (plan) {
      response.plan = plan;
      const issue = yield* issueService.findById(plan.issueId);
      if (issue) {
        response.issue = issue;
      }
    }

    // Load dependency information with issue numbers
    if (task.dependsOn?.length) {
      const dependencies = yield* taskDomainService.findByIds(task.dependsOn);
      const depResults = [];
      for (const d of dependencies) {
        const depPlan = yield* planDomainService.findById(d.planId);
        const depIssue = depPlan ? yield* issueService.findById(depPlan.issueId) : null;
        depResults.push({
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          issueNumber: depIssue?.number ?? null,
        });
      }
      response.dependencies = depResults;
    }

    // Find tasks that depend on this one
    const allPlanTasks = yield* taskDomainService.findByPlanId(task.planId);
    const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
    if (dependents.length > 0) {
      const depResults = [];
      for (const d of dependents) {
        const depPlan = yield* planDomainService.findById(d.planId);
        const depIssue = depPlan ? yield* issueService.findById(depPlan.issueId) : null;
        depResults.push({
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          issueNumber: depIssue?.number ?? null,
        });
      }
      response.dependents = depResults;
    }

    // Format task requirements prominently
    if (task.implementationPlan) {
      response.taskRequirements = formatTaskRequirements(task.implementationPlan);
    }

    return response;
  });
}

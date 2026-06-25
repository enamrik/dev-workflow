/**
 * loadTaskSession - Load a task session for execution
 *
 * Idempotent - safe to call multiple times. Handles:
 * - Access control: queued tasks require matching worker
 * - Terminal state detection: returns graceful response for COMPLETED/ABANDONED
 * - Session management: start/resume via TaskDomainService + GitWorktreeService
 * - Conflict detection: warns about files modified by prior tasks
 * - Context enrichment: loads issue, plan, dependencies, dependents
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import {
  ConflictDetectionService,
  type ConflictWarning,
} from "../../conflict-detection-service.js";
import { TaskDomainService, type TaskSession } from "../../domain/tasks/task-domain-service.js";
import {
  DependencyNotSatisfiedError,
  EntityNotFoundError,
  BusinessRuleError,
} from "../../domain/errors.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
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
    const { taskId, sessionId, workerId } = validateInput(loadTaskSessionSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const planDomainService = yield* PlanDomainService;
    const issueDomainService = yield* IssueDomainService;
    const gitWorktreeService = yield* GitWorktreeService;
    const conflictDetectionService = yield* ConflictDetectionService;
    const workerQueueDb = yield* WorkerQueueDbTag;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    const queueEntry = workerQueueDb?.findByTaskId(taskId) ?? null;
    if (queueEntry) {
      if (!workerId) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `Task is in dispatch queue and can only be claimed by a worker. ` +
              `Start a worker to continue this task, or remove it from the queue first.`
          )
        );
      }
      if (queueEntry.workerId !== workerId) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `Task queue mismatch: expected worker ${queueEntry.workerId ?? "(unclaimed)"}, got ${workerId}. ` +
              `The task must be claimed by this worker before loading.`
          )
        );
      }
    }

    if (task.isTerminal) {
      return yield* buildTerminalStateResponse(
        task,
        taskDomainService,
        planDomainService,
        issueDomainService
      );
    }

    const isResume = (task.startedAt !== undefined && task.startedAt !== null) || task.isActive;
    const now = new Date().toISOString();

    const taskPlan = yield* planDomainService.findById(task.planId);
    const taskIssue = taskPlan ? yield* issueDomainService.findById(taskPlan.issueId) : null;
    const issueNumber = taskIssue?.number;
    if (!issueNumber) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", `for task ${taskId}`));
    }

    let conflictWarnings: ConflictWarning[] | undefined;
    if (!isResume) {
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
            ? yield* issueDomainService.findById(blockingPlan.issueId)
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

      try {
        const conflictResult = yield* conflictDetectionService.detectConflicts(taskId);
        if (conflictResult.hasConflicts) {
          conflictWarnings = conflictResult.warnings;
        }
      } catch {
        // Conflict detection failures should not block task start
      }
    }

    let worktreePath: string | undefined = task.worktreePath;
    let branchName: string | undefined = task.branchName;

    // Always use isolated mode (worktree-based execution)
    if (!worktreePath) {
      const names = generateWorktreeNames(issueNumber, task.number, task.title);
      branchName = names.branchName;
      worktreePath = yield* Effect.catchAll(
        gitWorktreeService.createWorktree(names.worktreePath, branchName),
        (err) => Effect.promise(() => Promise.reject<string>(err))
      );
      yield* taskDomainService.updateWorktreeInfo(taskId, worktreePath, branchName);
    }

    if (!isResume) {
      yield* taskDomainService.activatePlan(task.planId, taskId, sessionId);
      yield* taskDomainService.start(taskId, sessionId);
    }

    yield* taskDomainService.updateSessionInfo(taskId, sessionId, isResume ? undefined : now, now);

    const finalTask = yield* taskDomainService.findById(taskId);
    if (!finalTask) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
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

    return yield* addTaskContext(
      response,
      sessionResult.task,
      taskDomainService,
      planDomainService,
      issueDomainService
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
  issueDomainService: IssueDomainService
) {
  return Effect.gen(function* () {
    const plan = yield* planDomainService.findById(task.planId);
    const issue = plan ? yield* issueDomainService.findById(plan.issueId) : null;

    const allTasks = yield* taskDomainService.findByPlanId(task.planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);
    const terminalStatuses = ["COMPLETED", "ABANDONED"];
    const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

    const nextTask = yield* findNextAvailableTaskInPlan(task.planId, taskDomainService);

    return {
      success: true,
      sessionId: "",
      task,
      resumed: false,
      startedAt: task.startedAt ?? "",
      issue,
      plan,
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
  issueDomainService: IssueDomainService
) {
  return Effect.gen(function* () {
    const plan = yield* planDomainService.findById(task.planId);
    if (plan) {
      response.plan = plan;
      const issue = yield* issueDomainService.findById(plan.issueId);
      if (issue) {
        response.issue = issue;
      }
    }

    if (task.dependsOn?.length) {
      const dependencies = yield* taskDomainService.findByIds(task.dependsOn);
      const depResults = [];
      for (const d of dependencies) {
        const depPlan = yield* planDomainService.findById(d.planId);
        const depIssue = depPlan ? yield* issueDomainService.findById(depPlan.issueId) : null;
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

    const allPlanTasks = yield* taskDomainService.findByPlanId(task.planId);
    const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
    if (dependents.length > 0) {
      const depResults = [];
      for (const d of dependents) {
        const depPlan = yield* planDomainService.findById(d.planId);
        const depIssue = depPlan ? yield* issueDomainService.findById(depPlan.issueId) : null;
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

    if (task.implementationPlan) {
      response.taskRequirements = formatTaskRequirements(task.implementationPlan);
    }

    return response;
  });
}

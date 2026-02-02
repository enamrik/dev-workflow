/**
 * loadTaskSession - Load a task session for execution
 *
 * Idempotent - safe to call multiple times. Handles:
 * - Access control: queued tasks require matching worker
 * - Terminal state detection: returns graceful response for COMPLETED/ABANDONED
 * - Session management: delegates to TaskSessionService for fresh start/resume
 * - Conflict detection: warns about files modified by prior tasks
 * - External sync: syncs status and auto-assigns on fresh start
 * - Context enrichment: loads issue, plan, dependencies, dependents
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import type { ConflictWarning } from "../../conflict-detection-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { TaskSessionService } from "../../domain/tasks/task-session-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
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
    const taskSessionService = yield* TaskSessionService;
    const planService = yield* PlanService;
    const issueService = yield* IssueService;
    const workerQueueDb = yield* WorkerQueueDbTag;

    // Check if task exists
    const task = yield* Effect.promise(() => taskService.findById(taskId));
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
      return yield* Effect.promise(() =>
        buildTerminalStateResponse(task, taskService, planService, issueService)
      );
    }

    // Delegate to idempotent startTaskSession (handles both fresh start and resume)
    const result = yield* Effect.promise(() =>
      taskSessionService.startTaskSession({
        taskId,
        sessionId,
        mode,
      })
    );

    // Build response
    const response: LoadTaskSessionResult = {
      success: true,
      sessionId,
      task: result.task,
      resumed: result.resumed,
      startedAt: result.startedAt,
    };

    // Include worktree info if available
    if (result.worktreePath) {
      response.worktreePath = result.worktreePath;
      response.branchName = result.branchName;
    }

    // Include conflict warnings if any were detected (only on fresh start)
    if (result.conflictWarnings && result.conflictWarnings.length > 0) {
      response.conflictWarnings = result.conflictWarnings;
      const taskPlan = yield* Effect.promise(() => planService.findById(result.task.planId));
      const taskIssue = taskPlan ? yield* issueService.findById(taskPlan.issueId) : null;
      response.conflictWarningMessage = formatConflictWarnings(
        result.conflictWarnings,
        taskIssue?.number
      );
    }

    // Sync to external project management provider
    yield* Effect.promise(() => taskService.syncTaskStatus(taskId, result.task.status));

    // On fresh start only: auto-assign and sync siblings
    if (!result.resumed) {
      yield* Effect.promise(() => taskService.assignIssue(taskId));

      // Sync sibling tasks that transitioned from BACKLOG to READY
      const siblingTasks = yield* Effect.promise(() =>
        taskService.findByPlanId(result.task.planId)
      );
      for (const sibling of siblingTasks) {
        if (sibling.id !== taskId && sibling.status === "READY") {
          yield* Effect.promise(() => taskService.syncTaskStatus(sibling.id, "READY"));
        }
      }
    }

    // Load full context
    return yield* Effect.promise(() =>
      addTaskContext(response, result.task, taskService, planService, issueService)
    );
  });
}

// =============================================================================
// Private Helper Functions
// =============================================================================

/**
 * Find the next available task in a plan (READY or BACKLOG).
 */
async function findNextAvailableTaskInPlan(
  planId: string,
  taskService: TaskService
): Promise<{ id: string; number: number; title: string; status: string } | null> {
  const tasks = await taskService.findByPlanId(planId);

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
}

/**
 * Build response for terminal state tasks (COMPLETED/ABANDONED).
 */
async function buildTerminalStateResponse(
  task: Task,
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService
): Promise<LoadTaskSessionResult> {
  // Get issue status
  const plan = await planService.findById(task.planId);
  const issue = plan ? await Effect.runPromise(issueService.findById(plan.issueId)) : null;

  // Check if all tasks are complete
  const allTasks = await taskService.findByPlanId(task.planId);
  const activeTasks = allTasks.filter((t) => !t.isDeleted);
  const terminalStatuses = ["COMPLETED", "ABANDONED"];
  const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

  // Find next available task in the plan
  const nextTask = await findNextAvailableTaskInPlan(task.planId, taskService);

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
  };
}

/**
 * Add full task context to response (issue, plan, dependencies).
 */
async function addTaskContext(
  response: LoadTaskSessionResult,
  task: Task,
  taskService: TaskService,
  planService: PlanService,
  issueService: IssueService
): Promise<LoadTaskSessionResult> {
  // Get plan and issue
  const plan = await planService.findById(task.planId);
  if (plan) {
    response.plan = plan;
    const issue = await Effect.runPromise(issueService.findById(plan.issueId));
    if (issue) {
      response.issue = issue;
    }
  }

  // Load dependency information with issue numbers
  if (task.dependsOn?.length) {
    const dependencies = await taskService.findByIds(task.dependsOn);
    const depResults = [];
    for (const d of dependencies) {
      const depPlan = await planService.findById(d.planId);
      const depIssue = depPlan
        ? await Effect.runPromise(issueService.findById(depPlan.issueId))
        : null;
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
  const allPlanTasks = await taskService.findByPlanId(task.planId);
  const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
  if (dependents.length > 0) {
    const depResults = [];
    for (const d of dependents) {
      const depPlan = await planService.findById(d.planId);
      const depIssue = depPlan
        ? await Effect.runPromise(issueService.findById(depPlan.issueId))
        : null;
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
}

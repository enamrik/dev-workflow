/**
 * Task-related MCP tools
 */

import {
  isTerminal,
  type DbClient,
  type DbSource,
  type TaskSessionService,
  type TaskManagementService,
  type ConflictDetectionService,
  type ConflictWarning,
  type TaskSyncService,
  type ProviderRegistry,
  type Project,
  type GitHubCLI,
  type AvailableLabel,
  type Task,
  type IssueService,
  type TaskService,
  type PlanService,
  type WorkerQueueDb,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Validate labels against available labels from the project management provider.
 *
 * Returns an error message if validation fails, or null if valid.
 * Gracefully degrades if provider is not available (returns null = valid).
 */
async function validateLabels(
  labels: Record<string, string | null>,
  ctx: TaskToolContext
): Promise<string | null> {
  // Skip validation if provider context is not available
  if (!ctx.providerRegistry || !ctx.project || !ctx.source || !ctx.githubCLI) {
    return null; // Graceful degradation - no validation
  }

  // Re-fetch project to get latest config
  const project = await ctx.source.projects.findById(ctx.project.id);
  if (!project) {
    return null; // Project not found - graceful degradation
  }

  // Get available labels from provider
  const provider = ctx.providerRegistry.createProvider(project, ctx);

  const result = await provider.getAvailableLabels();

  if (!result.supported || result.error) {
    return null; // Provider doesn't support labels or errored - no validation
  }

  // Build lookup map for efficient validation
  const availableLabelsMap = new Map<string, AvailableLabel>();
  for (const label of result.labels) {
    availableLabelsMap.set(label.name.toLowerCase(), label);
  }

  // Validate each label being set (ignore null values - those are removals)
  const errors: string[] = [];
  for (const [name, value] of Object.entries(labels)) {
    if (value === null) continue; // Removal - no validation needed

    const availableLabel = availableLabelsMap.get(name.toLowerCase());

    if (!availableLabel) {
      const availableNames = result.labels.map((l) => l.name).join(", ");
      errors.push(`Unknown label "${name}". Available labels: ${availableNames}`);
      continue;
    }

    // Check if value is valid (if label has constrained values)
    if (availableLabel.validValues !== null && value !== "") {
      const validValuesLower = availableLabel.validValues.map((v) => v.toLowerCase());
      if (!validValuesLower.includes(value.toLowerCase())) {
        errors.push(
          `Invalid value "${value}" for label "${name}". Valid values: ${availableLabel.validValues.join(", ")}`
        );
      }
    }
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

/**
 * Tool definitions for task operations
 */
export const taskToolDefinitions: ToolDefinition[] = [
  {
    name: "load_task_session",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Load a task for execution. " +
      "Returns full context (task, issue, plan) and starts/resumes the session. " +
      "Idempotent: if task is already IN_PROGRESS, returns context without restarting. " +
      "ALWAYS use 'isolated' mode (default) unless user explicitly requests otherwise.",
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
        mode: {
          type: "string",
          enum: ["isolated", "branch", "main"],
          description:
            "Execution mode. ALWAYS use 'isolated' (default) unless user explicitly requests otherwise. " +
            "'branch': only if user says 'branch mode' or 'no worktree'. " +
            "'main': only if user explicitly says 'on main', 'main mode', or 'skip PR'.",
        },
        workerId: {
          type: "string",
          description:
            "Worker UUID. When provided, enforces isolated mode - fails if mode is not 'isolated'. " +
            "Workers MUST pass their workerId to prevent accidental use of non-isolated modes.",
        },
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "abandon_task",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Abandons the current task. Marks task as ABANDONED. " +
      "Use force=true to bypass session ownership validation when state has drifted.",
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
        reason: {
          type: "string",
          description: "Reason for abandonment",
        },
        force: {
          type: "boolean",
          description:
            "Bypass session ownership validation. Use when task state has drifted " +
            "(e.g., session expired but task is still IN_PROGRESS). Requires user confirmation before use.",
        },
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "get_task",
    description:
      "Get task details by ID or number for quick lookups and questions about tasks. Returns task data only without loading execution context. Use load_task_session to start/resume work on a task with full context.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        taskNumber: {
          type: "number",
          description: "Task number within the issue (e.g., 1, 2, 3)",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (required when using taskNumber)",
        },
      },
    },
  },
  {
    name: "list_available_tasks",
    description:
      "List tasks available to work on (BACKLOG or READY status, not locked by another session).",
    inputSchema: {
      type: "object",
      properties: {
        planId: {
          type: "string",
          description: "Filter by plan UUID",
        },
        issueNumber: {
          type: "number",
          description: "Filter by issue number",
        },
      },
    },
  },
  {
    name: "delete_task",
    description:
      "Delete a task (soft delete). Only PLANNED tasks can be deleted. " +
      "Once an issue moves to BACKLOG (via move_issue_to_backlog), task numbers become immutable. " +
      "Use abandon_task instead for tasks past PLANNED status.",
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
    name: "update_task",
    description:
      "Update a task's properties. Use for tuning task details before execution. " +
      "Labels support both simple tags (empty string value) and key-value pairs. " +
      'Example: { "urgent": "", "product": "Case Workflow" }',
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        title: {
          type: "string",
          description: "New task title",
        },
        description: {
          type: "string",
          description: "New task description",
        },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "New acceptance criteria",
        },
        implementationPlan: {
          type: "string",
          description:
            "Technical implementation details for task execution (e.g., specific patterns to use, file locations)",
        },
        estimatedMinutes: {
          type: "number",
          description: "Estimated time in minutes",
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Task labels as key-value pairs. Empty string = simple tag, non-empty = value. " +
            "To remove a label, set its value to null. " +
            'Example: { "urgent": "", "product": "Case Workflow" }',
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "get_task_execution_prompt",
    description:
      "Generate a prompt for executing a task. Returns prompt-ready text with full context including issue, plan, and task details.",
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
    name: "log_task_progress",
    description:
      "Log progress during task execution (for audit trail). Call this to record what you're doing.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        sessionId: {
          type: "string",
          description: "Session ID executing the task",
        },
        message: {
          type: "string",
          description: "What was done (e.g., 'Created user model in src/models/user.ts')",
        },
        filesModified: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of files touched",
        },
      },
      required: ["taskId", "sessionId", "message"],
    },
  },
  {
    name: "get_task_execution_log",
    description:
      "Get the execution log for a task. Shows recorded progress entries from task execution.",
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
    name: "check_task_conflicts",
    description:
      "Check for potential file conflicts before starting a task. Returns warnings about files modified by prior completed tasks in the same plan. This is a dry-run that doesn't start the task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID to check for conflicts",
        },
      },
      required: ["taskId"],
    },
  },
];

/**
 * Service context for task handlers
 */
export interface TaskToolContext {
  db: DbClient;
  issueService: IssueService;
  planService: PlanService;
  taskService: TaskService;
  taskSessionService: TaskSessionService;
  taskManagementService: TaskManagementService;
  conflictDetectionService?: ConflictDetectionService;
  /** Optional - for syncing task status changes to GitHub */
  taskSyncService?: TaskSyncService;
  /** Optional - for label validation against project management provider */
  providerRegistry?: ProviderRegistry;
  project?: Project;
  /** Optional - for accessing global repositories (projects, types) */
  source?: DbSource;
  githubCLI?: GitHubCLI;
  /** Optional - for enriching task data with worker info */
  workerQueueDb?: WorkerQueueDb;
}

/**
 * Handle load_task_session tool call
 *
 * Idempotent task session loader - safe to call multiple times.
 * Uses startedAt as the signal for "has work started":
 * - startedAt is null → fresh start (create worktree, transition to IN_PROGRESS)
 * - startedAt is set → resume (return existing context)
 *
 * Access control:
 * - Queued tasks require worker with matching workerId
 * - Workers must use isolated mode
 *
 * Terminal states (COMPLETED/ABANDONED) return gracefully with issue status
 * and next task info, rather than erroring.
 *
 * Supports 3 modes:
 * - 'isolated' (default): creates worktree + branch for parallel work
 * - 'branch': creates branch only, checks out in main repo
 * - 'main': works directly on main, skips PR review
 */
export async function handleLoadTaskSession(
  ctx: TaskToolContext,
  args: {
    taskId: string;
    sessionId: string;
    mode?: "isolated" | "branch" | "main";
    workerId?: string;
  }
): Promise<ToolResponse> {
  const { taskId, sessionId, mode = "isolated", workerId } = args;

  // Check if task exists
  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Access control: queued tasks require worker with matching workerId
  const queueEntry = ctx.workerQueueDb?.findByTaskId(taskId);
  if (queueEntry) {
    if (!workerId) {
      return errorResponse(
        `Task is in dispatch queue and can only be claimed by a worker. ` +
          `Start a worker to continue this task, or remove it from the queue first.`
      );
    }
    if (queueEntry.workerId !== workerId) {
      return errorResponse(
        `Task queue mismatch: expected worker ${queueEntry.workerId ?? "(unclaimed)"}, got ${workerId}. ` +
          `The task must be claimed by this worker before loading.`
      );
    }
  }

  // Access control: workers must use isolated mode
  if (workerId && mode !== "isolated") {
    return errorResponse(
      `Workers MUST use isolated mode. Got mode="${mode}" with workerId="${workerId}". ` +
        `Workers are not allowed to use branch or main modes.`
    );
  }

  // Terminal states - return gracefully with context (not an error)
  if (isTerminal(task)) {
    return buildTerminalStateResponse(ctx, task);
  }

  // Delegate to idempotent startTaskSession (handles both fresh start and resume)
  const result = await ctx.taskSessionService.startTaskSession({
    taskId,
    sessionId,
    mode,
  });

  // Build response
  const response: Record<string, unknown> = {
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
    const taskPlan = ctx.planService.findById(result.task.planId);
    const taskIssue = taskPlan ? ctx.issueService.findById(taskPlan.issueId) : null;
    response.conflictWarningMessage = formatConflictWarnings(
      result.conflictWarnings,
      taskIssue?.number
    );
  }

  // Sync to external project management provider
  if (ctx.taskSyncService) {
    try {
      await ctx.taskSyncService.syncTaskStatus(taskId, result.task.status);
    } catch (error) {
      console.warn(`Failed to sync task status: ${error}`);
    }

    // On fresh start only: auto-assign and sync siblings
    if (!result.resumed) {
      try {
        await ctx.taskSyncService.assignIssue(taskId);
      } catch (error) {
        console.warn(`Failed to auto-assign issue: ${error}`);
      }

      // Sync sibling tasks that transitioned from BACKLOG to READY
      const siblingTasks = ctx.taskService.findByPlanId(result.task.planId);
      for (const sibling of siblingTasks) {
        if (sibling.id !== taskId && sibling.status === "READY") {
          try {
            await ctx.taskSyncService.syncTaskStatus(sibling.id, "READY");
          } catch (error) {
            console.warn(`Failed to sync sibling task READY status: ${error}`);
          }
        }
      }
    }
  }

  // Load full context
  return addTaskContext(ctx, response, result.task);
}

/**
 * Build response for terminal state tasks (COMPLETED/ABANDONED)
 *
 * Returns similar shape to complete_task so callers know what to do next:
 * - Workers: call end_worker_session and exit
 * - Inline: inform user task is done, show next steps
 */
function buildTerminalStateResponse(ctx: TaskToolContext, task: Task): ToolResponse {
  // Get issue status
  const plan = ctx.planService.findById(task.planId);
  const issue = plan ? ctx.issueService.findById(plan.issueId) : null;

  // Check if all tasks are complete
  const allTasks = ctx.taskService.findByPlanId(task.planId);
  const activeTasks = allTasks.filter((t) => !t.isDeleted);
  const terminalStatuses = ["COMPLETED", "ABANDONED"];
  const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

  // Find next available task in the plan
  const nextTask = findNextAvailableTaskInPlan(ctx, task.planId);

  return successResponse({
    success: true,
    task,
    issue,
    plan,
    // Key fields that signal "no work needed"
    nextTask,
    allTasksComplete,
    issueNumber: issue?.number ?? null,
    issueStatus: issue?.status ?? null,
    message: `Task is already ${task.status}. No work needed.`,
  });
}

/**
 * Find the next available task in a plan (READY or BACKLOG)
 */
function findNextAvailableTaskInPlan(
  ctx: TaskToolContext,
  planId: string
): { id: string; number: number; title: string; status: string } | null {
  const tasks = ctx.taskService.findByPlanId(planId);

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
 * Add full task context to response (issue, plan, dependencies)
 */
function addTaskContext(
  ctx: TaskToolContext,
  response: Record<string, unknown>,
  task: Task
): ToolResponse {
  // Get plan and issue
  const plan = ctx.planService.findById(task.planId);
  if (plan) {
    response.plan = plan;
    const issue = ctx.issueService.findById(plan.issueId);
    if (issue) {
      response.issue = issue;
    }
  }

  // Load dependency information with issue numbers
  if (task.dependsOn?.length) {
    const dependencies = ctx.taskService.findByIds(task.dependsOn);
    response.dependencies = dependencies.map((d) => {
      const depPlan = ctx.planService.findById(d.planId);
      const depIssue = depPlan ? ctx.issueService.findById(depPlan.issueId) : null;
      return {
        id: d.id,
        number: d.number,
        title: d.title,
        status: d.status,
        issueNumber: depIssue?.number ?? null,
      };
    });
  }

  // Find tasks that depend on this one
  const allPlanTasks = ctx.taskService.findByPlanId(task.planId);
  const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
  if (dependents.length > 0) {
    response.dependents = dependents.map((d) => {
      const depPlan = ctx.planService.findById(d.planId);
      const depIssue = depPlan ? ctx.issueService.findById(depPlan.issueId) : null;
      return {
        id: d.id,
        number: d.number,
        title: d.title,
        status: d.status,
        issueNumber: depIssue?.number ?? null,
      };
    });
  }

  // Format task requirements prominently
  if (task.implementationPlan) {
    response.taskRequirements = formatTaskRequirements(task.implementationPlan);
  }

  return successResponse(response);
}

/**
 * Format conflict warnings into a human-readable message
 * @param warnings - The conflict warnings to format
 * @param issueNumber - Optional issue number for #issue.task format
 */
function formatConflictWarnings(warnings: ConflictWarning[], issueNumber?: number | null): string {
  const lines = ["⚠️ Potential file conflicts detected:"];
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

/**
 * Handle abandon_task tool call
 *
 * When force=true:
 * - Bypasses session ownership validation
 * - Use when task state has drifted (e.g., session expired but task is still IN_PROGRESS)
 *
 * Returns same context as complete_task for consistent close_issue prompting:
 * - allTasksComplete: whether all tasks are in terminal state
 * - issueNumber: for easy close_issue call
 * - nextTask: next available task in the plan
 */
export async function handleAbandonTask(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; reason?: string; force?: boolean }
): Promise<ToolResponse> {
  const { taskId, sessionId, reason, force = false } = args;

  const task = await ctx.taskSessionService.abandonTask(taskId, sessionId, reason, force);

  // Sync to external project management provider (service handles "should I sync?" internally)
  if (ctx.taskSyncService) {
    try {
      await ctx.taskSyncService.syncTaskStatus(taskId, "ABANDONED");
    } catch (error) {
      // Log but don't fail - sync is best effort after local update
      console.warn(`Failed to sync task status: ${error}`);
    }
  }

  // Get issue context for close_issue prompting (same pattern as complete_task)
  const plan = ctx.planService.findById(task.planId);
  const issue = plan ? ctx.issueService.findById(plan.issueId) : null;

  // Check if all tasks are in terminal state
  const allTasks = ctx.taskService.findByPlanId(task.planId);
  const activeTasks = allTasks.filter((t) => !t.isDeleted);
  const terminalStatuses = ["COMPLETED", "ABANDONED"];
  const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

  // Find next available task
  const nextTask = findNextAvailableTaskInPlan(ctx, task.planId);

  return successResponse({
    success: true,
    task,
    forced: force,
    allTasksComplete,
    issueNumber: issue?.number ?? null,
    nextTask,
    message: force ? "Task force-abandoned" : "Task abandoned",
  });
}

/**
 * Enriched worker info for tasks with an active worker session.
 */
export interface TaskWorkerInfo {
  /** Worker ID from dispatch queue (if task is dispatched) */
  workerId: string | null;
  /** Session ID from the task itself */
  sessionId: string | null;
}

/**
 * Enriched PR info for tasks with an associated PR.
 */
export interface TaskPRInfo {
  prNumber: number;
  prUrl: string;
  prStatus: string;
}

/**
 * Enriched task data with worker and PR info.
 * This is used by both get_task and get_issue (with includePlan).
 */
export interface EnrichedTaskData {
  id: string;
  planId: string;
  number: number;
  order: number;
  title: string;
  description: string;
  status: string;
  type: string;
  source: string;
  acceptanceCriteria: string[];
  estimatedMinutes?: number | null;
  dependsOn?: string[] | null;
  labels?: Record<string, string> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Worktree path for isolated mode tasks */
  worktreePath?: string | null;
  /** Branch name for isolated/branch mode tasks */
  branchName?: string | null;
  /** Worker session info (present when task has an active session) */
  workerInfo?: TaskWorkerInfo;
  /** PR details (present when task has an associated PR) */
  prInfo?: TaskPRInfo;
}

/**
 * Slim enriched task data for get_issue response.
 * Contains only the essential fields plus worker and PR info.
 */
export interface SlimEnrichedTaskData {
  id: string;
  number: number;
  title: string;
  status: string;
  /** Worktree path for isolated mode tasks */
  worktreePath?: string | null;
  /** Branch name for isolated/branch mode tasks */
  branchName?: string | null;
  /** Worker session info (present when task has an active session) */
  workerInfo?: TaskWorkerInfo;
  /** PR details (present when task has an associated PR) */
  prInfo?: TaskPRInfo;
}

/**
 * Enrich a task with worker and PR info.
 *
 * Worker info comes from two sources:
 * - sessionId: from the task itself (set during load_task_session)
 * - workerId: from the dispatch queue (set when task is claimed by a worker)
 *
 * PR info comes from task fields: prNumber, prUrl, prStatus
 *
 * @param task - The task to enrich
 * @param workerQueueDb - Optional service for looking up worker info
 * @returns The enriched task data
 */
export function enrichTaskData(
  task: {
    id: string;
    planId: string;
    number: number;
    order: number;
    title: string;
    description: string;
    status: string;
    type: string;
    source: string;
    acceptanceCriteria: string[];
    estimatedMinutes?: number | null;
    dependsOn?: string[] | null;
    labels?: Record<string, string> | null;
    sessionId?: string | null;
    worktreePath?: string | null;
    branchName?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    prStatus?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  },
  workerQueueDb?: WorkerQueueDb
): EnrichedTaskData {
  const enriched: EnrichedTaskData = {
    id: task.id,
    planId: task.planId,
    number: task.number,
    order: task.order,
    title: task.title,
    description: task.description,
    status: task.status,
    type: task.type,
    source: task.source,
    acceptanceCriteria: task.acceptanceCriteria,
    estimatedMinutes: task.estimatedMinutes,
    dependsOn: task.dependsOn,
    labels: task.labels,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
  };

  // Add worker info if task has an active session
  const hasActiveSession = task.sessionId && task.status === "IN_PROGRESS";
  if (hasActiveSession) {
    // Look up worker ID from dispatch queue
    let workerId: string | null = null;
    if (workerQueueDb) {
      const queueEntry = workerQueueDb.findByTaskId(task.id);
      workerId = queueEntry?.workerId ?? null;
    }

    enriched.workerInfo = {
      workerId,
      sessionId: task.sessionId ?? null,
    };
  }

  // Add PR info if task has a PR
  if (task.prNumber && task.prUrl && task.prStatus) {
    enriched.prInfo = {
      prNumber: task.prNumber,
      prUrl: task.prUrl,
      prStatus: task.prStatus,
    };
  }

  return enriched;
}

/**
 * Create slim enriched task data for get_issue response.
 *
 * @param task - The task to create slim data for
 * @param workerQueueDb - Optional service for looking up worker info
 * @returns Slim enriched task data
 */
export function createSlimEnrichedTaskData(
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
    sessionId?: string | null;
    worktreePath?: string | null;
    branchName?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    prStatus?: string | null;
  },
  workerQueueDb?: WorkerQueueDb
): SlimEnrichedTaskData {
  const slim: SlimEnrichedTaskData = {
    id: task.id,
    number: task.number,
    title: task.title,
    status: task.status,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
  };

  // Add worker info if task has an active session
  const hasActiveSession = task.sessionId && task.status === "IN_PROGRESS";
  if (hasActiveSession) {
    // Look up worker ID from dispatch queue
    let workerId: string | null = null;
    if (workerQueueDb) {
      const queueEntry = workerQueueDb.findByTaskId(task.id);
      workerId = queueEntry?.workerId ?? null;
    }

    slim.workerInfo = {
      workerId,
      sessionId: task.sessionId ?? null,
    };
  }

  // Add PR info if task has a PR
  if (task.prNumber && task.prUrl && task.prStatus) {
    slim.prInfo = {
      prNumber: task.prNumber,
      prUrl: task.prUrl,
      prStatus: task.prStatus,
    };
  }

  return slim;
}

/**
 * Handle get_task tool call
 *
 * Lightweight task lookup - returns task data with worker and PR info
 * without loading full execution context (issue, plan details).
 */
export function handleGetTask(
  ctx: TaskToolContext,
  args: { taskId?: string; taskNumber?: number; issueNumber?: number }
): ToolResponse {
  const { taskId, taskNumber, issueNumber } = args;

  let task;

  if (taskId) {
    task = ctx.taskService.findById(taskId);
  } else if (taskNumber !== undefined && issueNumber !== undefined) {
    const issue = ctx.issueService.findByNumber(issueNumber);
    if (!issue) {
      return errorResponse(`Issue not found: #${issueNumber}`);
    }

    const plan = ctx.planService.findByIssueId(issue.id);
    if (!plan) {
      return errorResponse(`No plan found for issue #${issueNumber}`);
    }

    const tasks = ctx.taskService.findByPlanId(plan.id);
    task = tasks.find((t) => t.number === taskNumber);
  } else {
    return errorResponse("Either taskId or both taskNumber and issueNumber are required");
  }

  if (!task) {
    return errorResponse(
      taskId
        ? `Task not found: ${taskId}`
        : `Task #${taskNumber} not found in issue #${issueNumber}`
    );
  }

  // Return enriched task data with worker and PR info
  const enriched = enrichTaskData(task, ctx.workerQueueDb);
  return successResponse(enriched);
}

/**
 * Format task requirements for Claude consumption
 */
function formatTaskRequirements(implementationPlan: string): string {
  return "## Task-Specific Instructions\n" + implementationPlan;
}

/**
 * Handle list_available_tasks tool call
 *
 * Returns all BACKLOG and READY tasks with availability information.
 * A task is available only if:
 * - Status is BACKLOG or READY
 * - All dependencies are satisfied (COMPLETED or ABANDONED)
 * - Not locked by another session
 */
export async function handleListAvailableTasks(
  ctx: TaskToolContext,
  args: { planId?: string; issueNumber?: number }
): Promise<ToolResponse> {
  const { planId, issueNumber } = args;

  let tasks: ReturnType<typeof ctx.taskService.findMany> = [];

  if (planId) {
    tasks = ctx.taskService.findByPlanId(planId);
  } else if (issueNumber) {
    const issue = ctx.issueService.findByNumber(issueNumber);
    if (issue) {
      const plan = ctx.planService.findByIssueId(issue.id);
      if (plan) {
        tasks = ctx.taskService.findByPlanId(plan.id);
      }
    }
  } else {
    tasks = ctx.taskService.findMany({});
  }

  // Filter to only available tasks and include availability info
  const availableTasks = [];
  for (const task of tasks) {
    const isAvailable = await ctx.taskSessionService.isTaskAvailable(task.id);
    if (isAvailable) {
      availableTasks.push({
        ...task,
        isAvailable: true,
        blockedBy: [] as string[],
      });
    }
  }

  return successResponse({
    success: true,
    tasks: availableTasks,
  });
}

/**
 * Handle delete_task tool call
 */
export function handleDeleteTask(ctx: TaskToolContext, args: { taskId: string }): ToolResponse {
  const { taskId } = args;

  const task = ctx.taskManagementService.deleteTask(taskId, "claude-agent");

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle update_task tool call
 *
 * Supports updating task properties including labels.
 * Labels are merged with existing labels - to remove a label, set its value to null.
 * Labels are validated against the available labels from the project management provider.
 */
export async function handleUpdateTask(
  ctx: TaskToolContext,
  args: {
    taskId: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    implementationPlan?: string;
    estimatedMinutes?: number;
    labels?: Record<string, string | null>;
  }
): Promise<ToolResponse> {
  const {
    taskId,
    title,
    description,
    acceptanceCriteria,
    implementationPlan,
    estimatedMinutes,
    labels,
  } = args;

  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (acceptanceCriteria !== undefined) updates.acceptanceCriteria = acceptanceCriteria;
  if (implementationPlan !== undefined) updates.implementationPlan = implementationPlan;
  if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

  // Handle labels - validate and merge with existing, null values remove labels
  if (labels !== undefined) {
    // Validate labels against available labels from provider
    const validationError = await validateLabels(labels, ctx);
    if (validationError) {
      return errorResponse(`Label validation failed: ${validationError}`);
    }

    const currentLabels = task.labels ?? {};
    const mergedLabels: Record<string, string> = { ...currentLabels };

    for (const [key, value] of Object.entries(labels)) {
      if (value === null) {
        // Remove the label
        delete mergedLabels[key];
      } else {
        // Add or update the label
        mergedLabels[key] = value;
      }
    }

    // Use null to clear the field (undefined is ignored by Drizzle spread)
    updates.labels = Object.keys(mergedLabels).length > 0 ? mergedLabels : null;
  }

  const updatedTask = ctx.taskService.update(taskId, updates);

  return successResponse({
    success: true,
    task: updatedTask,
  });
}

/**
 * Handle get_task_execution_prompt tool call
 */
export function handleGetTaskExecutionPrompt(
  ctx: TaskToolContext,
  args: { taskId: string }
): ToolResponse {
  const { taskId } = args;

  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Get parent context
  const plan = ctx.planService.findById(task.planId);
  if (!plan) {
    return errorResponse(`Plan not found for task: ${taskId}`);
  }

  const issue = ctx.issueService.findById(plan.issueId);
  if (!issue) {
    return errorResponse(`Issue not found for plan: ${plan.id}`);
  }

  // Generate session ID for the subagent
  const sessionId = crypto.randomUUID();

  // Build the execution prompt
  const issueAcceptanceCriteria = issue.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
  const taskAcceptanceCriteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");

  const prompt = `# Task Execution

You are executing task #${task.order} for issue #${issue.number}.

## Issue: ${issue.title}
${issue.description}

**Issue Acceptance Criteria:**
${issueAcceptanceCriteria || "- None specified"}

## Plan Approach
${plan.approach}

## Your Task: ${task.title}
${task.description}

**Task Acceptance Criteria:**
${taskAcceptanceCriteria || "- None specified"}

${task.implementationPlan ? `## Additional Instructions\n${task.implementationPlan}\n` : ""}
## Execution Instructions

1. Implement the task following the plan's approach
2. Ensure all acceptance criteria are met
3. Use \`log_task_progress\` to record significant steps (for audit trail)
4. When complete: call \`complete_task_session\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
5. If blocked: call \`abandon_task\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
   - reason: (explain why)

**Important:** You have access to dev-workflow-tracker MCP tools for task lifecycle management.`;

  return successResponse({
    success: true,
    taskId,
    sessionId,
    prompt,
  });
}

/**
 * Handle log_task_progress tool call
 */
export function handleLogTaskProgress(
  ctx: TaskToolContext,
  args: {
    taskId: string;
    sessionId: string;
    message: string;
    filesModified?: string[];
  }
): ToolResponse {
  const { taskId, sessionId, message, filesModified } = args;

  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Insert execution log entry
  const log = ctx.db.executionLogs.create({
    taskId,
    sessionId,
    message,
    filesModified: filesModified || undefined,
  });

  return successResponse({
    success: true,
    logId: log.id,
    taskId,
    message,
  });
}

/**
 * Handle get_task_execution_log tool call
 */
export function handleGetTaskExecutionLog(
  ctx: TaskToolContext,
  args: { taskId: string }
): ToolResponse {
  const { taskId } = args;

  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Get all execution log entries for this task
  const logs = ctx.db.executionLogs.findByTaskId(taskId);

  const entries = logs.map((log) => ({
    id: log.id,
    sessionId: log.sessionId,
    message: log.message,
    filesModified: log.filesModified,
    createdAt: log.createdAt,
  }));

  return successResponse({
    success: true,
    taskId,
    entries,
  });
}

/**
 * Handle check_task_conflicts tool call
 *
 * Dry-run conflict detection without starting the task.
 * Useful for previewing potential issues before committing to start.
 */
export function handleCheckTaskConflicts(
  ctx: TaskToolContext,
  args: { taskId: string }
): ToolResponse {
  const { taskId } = args;

  // Verify task exists
  const task = ctx.taskService.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Check if conflict detection service is available
  if (!ctx.conflictDetectionService) {
    return successResponse({
      success: true,
      taskId,
      hasConflicts: false,
      warnings: [],
      message: "Conflict detection is not configured",
    });
  }

  // Run conflict detection
  const result = ctx.conflictDetectionService.detectConflicts(taskId);

  // Build response
  const response: Record<string, unknown> = {
    success: true,
    taskId,
    taskTitle: task.title,
    hasConflicts: result.hasConflicts,
    warnings: result.warnings,
  };

  if (result.hasConflicts) {
    // Get issue number for #issue.task format in warning message
    const taskPlan = ctx.planService.findById(task.planId);
    const taskIssue = taskPlan ? ctx.issueService.findById(taskPlan.issueId) : null;
    response.warningMessage = formatConflictWarnings(result.warnings, taskIssue?.number);
  } else {
    response.message = "No potential conflicts detected with prior tasks";
  }

  // Include summary of all files modified by prior tasks for context
  if (result.priorTaskFiles.size > 0) {
    const filesModifiedByPriorTasks: string[] = [];
    for (const filePath of result.priorTaskFiles.keys()) {
      filesModifiedByPriorTasks.push(filePath);
    }
    response.priorTaskFiles = filesModifiedByPriorTasks;
  }

  return successResponse(response);
}

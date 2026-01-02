/**
 * Task-related MCP tools
 */

import { eq, asc } from "drizzle-orm";
import {
  taskExecutionLogs,
  EventBus,
  type DatabaseService,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type TaskSessionService,
  type TaskManagementService,
  type LabelService,
  type Label,
  type TaskStatus,
  type TaskExecutionLogRow,
  type ConflictDetectionService,
  type ConflictWarning,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

/**
 * Tool definitions for task operations
 */
export const taskToolDefinitions: ToolDefinition[] = [
  {
    name: "update_task_status",
    description:
      "Update task status. Records change in history without creating snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        status: {
          type: "string",
          enum: ["PENDING", "IN_PROGRESS", "PR_REVIEW", "COMPLETED", "ABANDONED"],
          description: "New status for the task",
        },
        notes: {
          type: "string",
          description: "Optional notes about status change",
        },
      },
      required: ["taskId", "status"],
    },
  },
  {
    name: "start_task_session",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Starts working on a task. " +
      "Supports 3 modes: 'isolated' (default) creates worktree+branch for parallel work, " +
      "'branch' creates branch only for single-task focus, " +
      "'main' works directly on main for quick fixes (skips PR review).",
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
            "Execution mode. 'isolated' (default): creates worktree+branch for parallel work. " +
            "'branch': creates branch only, checks out in main repo. " +
            "'main': work directly on main branch, skips PR review.",
        },
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "complete_task_session",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Completes the current task. Marks task as COMPLETED.",
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
        notes: {
          type: "string",
          description: "Completion notes",
        },
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "abandon_task_session",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. Abandons the current task. Marks task as ABANDONED.",
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
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "get_task",
    description:
      "Get task details by ID or number for quick lookups and questions about tasks. Returns task data only without loading execution context. Use get_task_for_session instead when starting work on a task.",
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
    name: "get_task_for_session",
    description:
      "Get full task details for execution. Loads complete context including issue, plan, and label content. Use get_task for quick lookups without execution context.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        includeContext: {
          type: "boolean",
          description: "Include related issue and plan context (default: true)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "list_available_tasks",
    description:
      "List tasks available to work on (PENDING status, not locked by another session).",
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
    name: "update_task_labels",
    description:
      "Update labels for a task. Labels map to files in .track/labels/{label}.md.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description:
            'Array of labels (e.g., ["db", "api", "security"])',
        },
      },
      required: ["taskId", "labels"],
    },
  },
  {
    name: "list_available_task_labels",
    description: "List all available task labels. Labels are defined in .track/labels/{name}.md files.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_task_label",
    description: "Get a task label's content by name. Returns the label's markdown content.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Label name (without .md extension)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_task_label",
    description:
      "Create a new task label. Labels are markdown files in .track/labels/ that provide contextual guidance for tasks.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Label name (without .md extension). Use only letters, numbers, hyphens, and underscores.",
        },
        content: {
          type: "string",
          description: "Label content in markdown format",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "update_task_label",
    description: "Update an existing task label's content.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Label name (without .md extension)",
        },
        content: {
          type: "string",
          description: "New label content in markdown format",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "remove_task_label",
    description: "Remove a task label. This deletes the label file from .track/labels/.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Label name (without .md extension)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "add_manual_task",
    description:
      "Add a user-created task to a plan. Manual tasks are preserved during plan regeneration.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        title: {
          type: "string",
          description: "Task title",
        },
        description: {
          type: "string",
          description: "Task description",
        },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Acceptance criteria for the task",
        },
        estimatedMinutes: {
          type: "number",
          description: "Estimated time in minutes",
        },
        insertAfterTaskId: {
          type: "string",
          description: "Optional: Task ID to insert after (for ordering)",
        },
      },
      required: ["issueNumber", "title", "description"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task (soft delete). Only PENDING tasks can be deleted.",
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
      "Update a task's properties. Use for tuning task details before execution.",
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
        contextInstructions: {
          type: "string",
          description:
            "Custom instructions for task execution (e.g., 'use existing auth pattern in src/auth')",
        },
        estimatedMinutes: {
          type: "number",
          description: "Estimated time in minutes",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels",
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
          description:
            "What was done (e.g., 'Created user model in src/models/user.ts')",
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
  dbService: DatabaseService;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  taskSessionService: TaskSessionService;
  taskManagementService: TaskManagementService;
  labelService: LabelService;
  taskExecutionLogsSchema: typeof taskExecutionLogs;
  conflictDetectionService?: ConflictDetectionService;
}

/**
 * Handle update_task_status tool call
 */
export function handleUpdateTaskStatus(
  ctx: TaskToolContext,
  args: { taskId: string; status: TaskStatus; notes?: string }
): ToolResponse {
  const { taskId, status, notes } = args;

  // Get current task to capture previous status
  const currentTask = ctx.taskRepository.findById(taskId);
  if (!currentTask) {
    return errorResponse(`Task not found: ${taskId}`);
  }
  const fromStatus = currentTask.status;

  const updatedTask = ctx.taskRepository.updateStatus(
    taskId,
    status,
    "claude-agent",
    notes
  );

  // Emit task:status_changed event for real-time UI updates
  const plan = ctx.planRepository.findById(currentTask.planId);
  if (plan) {
    const issue = ctx.issueRepository.findById(plan.issueId);
    if (issue) {
      const eventBus = EventBus.getInstance();
      eventBus.emit("task:status_changed", {
        taskId,
        planId: currentTask.planId,
        issueNumber: issue.number,
        fromStatus,
        toStatus: status,
      });
    }
  }

  return successResponse(updatedTask);
}

/**
 * Handle start_task_session tool call
 *
 * Supports 3 modes:
 * - 'isolated' (default): creates worktree + branch for parallel work
 * - 'branch': creates branch only, checks out in main repo
 * - 'main': works directly on main, skips PR review
 */
export async function handleStartTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; mode?: "isolated" | "branch" | "main" }
): Promise<ToolResponse> {
  const { taskId, sessionId, mode = "isolated" } = args;

  const result = await ctx.taskSessionService.startTaskSession({
    taskId,
    sessionId,
    mode,
  });

  const response: Record<string, unknown> = {
    success: true,
    task: result.task,
    sessionId: result.sessionId,
    startedAt: result.startedAt,
  };

  // Include worktree info if created
  if (result.worktreePath) {
    response.worktreePath = result.worktreePath;
    response.branchName = result.branchName;
  }

  // Include conflict warnings if any were detected
  if (result.conflictWarnings && result.conflictWarnings.length > 0) {
    response.conflictWarnings = result.conflictWarnings;
    response.conflictWarningMessage = formatConflictWarnings(result.conflictWarnings);
  }

  return successResponse(response);
}

/**
 * Format conflict warnings into a human-readable message
 */
function formatConflictWarnings(warnings: ConflictWarning[]): string {
  const lines = ["⚠️ Potential file conflicts detected:"];
  for (const warning of warnings) {
    const modifiers = warning.modifiedBy
      .map((m) => `Task #${m.taskNumber} (${m.taskTitle})`)
      .join(", ");
    lines.push(`  - ${warning.filePath} was modified by: ${modifiers}`);
  }
  lines.push("");
  lines.push("These files were touched by prior tasks. Review carefully when making changes.");
  return lines.join("\n");
}

/**
 * Handle complete_task_session tool call
 */
export async function handleCompleteTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; notes?: string }
): Promise<ToolResponse> {
  const { taskId, sessionId, notes } = args;

  const task = await ctx.taskSessionService.completeTaskSession({
    taskId,
    sessionId,
    notes,
  });

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle abandon_task_session tool call
 */
export async function handleAbandonTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; reason?: string }
): Promise<ToolResponse> {
  const { taskId, sessionId, reason } = args;

  const task = await ctx.taskSessionService.abandonTaskSession(
    taskId,
    sessionId,
    reason
  );

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle get_task tool call
 *
 * Lightweight task lookup - returns task data only without loading
 * execution context (labels, issue, plan).
 */
export function handleGetTask(
  ctx: TaskToolContext,
  args: { taskId?: string; taskNumber?: number; issueNumber?: number }
): ToolResponse {
  const { taskId, taskNumber, issueNumber } = args;

  let task;

  if (taskId) {
    // Direct lookup by UUID
    task = ctx.taskRepository.findById(taskId);
  } else if (taskNumber !== undefined && issueNumber !== undefined) {
    // Lookup by task number + issue number
    const issue = ctx.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      return errorResponse(`Issue not found: #${issueNumber}`);
    }

    const plan = ctx.planRepository.findByIssueId(issue.id);
    if (!plan) {
      return errorResponse(`No plan found for issue #${issueNumber}`);
    }

    const tasks = ctx.taskRepository.findByPlanId(plan.id);
    task = tasks.find((t) => t.number === taskNumber);
  } else {
    return errorResponse(
      "Either taskId or both taskNumber and issueNumber are required"
    );
  }

  if (!task) {
    return errorResponse(
      taskId
        ? `Task not found: ${taskId}`
        : `Task #${taskNumber} not found in issue #${issueNumber}`
    );
  }

  // Return minimal task data without loading context
  return successResponse({
    id: task.id,
    planId: task.planId,
    number: task.number,
    order: task.order,
    title: task.title,
    description: task.description,
    status: task.status,
    source: task.source,
    acceptanceCriteria: task.acceptanceCriteria,
    estimatedMinutes: task.estimatedMinutes,
    labels: task.labels, // Just the label names, not loaded content
    dependsOn: task.dependsOn,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

/**
 * Handle get_task_for_session tool call
 */
export async function handleGetTaskForSession(
  ctx: TaskToolContext,
  args: { taskId: string; includeContext?: boolean }
): Promise<ToolResponse> {
  const { taskId, includeContext = true } = args;

  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  const result: Record<string, unknown> = { task };

  if (includeContext) {
    const plan = ctx.planRepository.findById(task.planId);
    if (plan) {
      result.plan = plan;
      const issue = ctx.issueRepository.findById(plan.issueId);
      if (issue) {
        result.issue = issue;
      }
    }
  }

  // Load dependency information
  if (task.dependsOn?.length) {
    const dependencies = ctx.taskRepository.findByIds(task.dependsOn);
    result.dependencies = dependencies.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
    }));
  }

  // Find tasks that depend on this one
  const allPlanTasks = ctx.taskRepository.findByPlanId(task.planId);
  const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
  if (dependents.length > 0) {
    result.dependents = dependents.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
    }));
  }

  // Load label content
  if (task.labels?.length) {
    const loadedLabels = await ctx.labelService.loadLabelsForTask(task.labels);
    if (loadedLabels.length > 0) {
      result.loadedLabels = loadedLabels;
    }
  }

  // Format task requirements prominently
  if (task.contextInstructions || result.loadedLabels) {
    result.taskRequirements = formatTaskRequirements(
      task.contextInstructions,
      result.loadedLabels as Label[] | undefined
    );
  }

  return successResponse(result);
}

/**
 * Format task requirements for Claude consumption
 */
function formatTaskRequirements(
  contextInstructions: string | undefined,
  labels: Label[] | undefined
): string {
  const parts: string[] = [];

  if (contextInstructions) {
    parts.push("## Task-Specific Instructions\n" + contextInstructions);
  }

  if (labels?.length) {
    parts.push("## Required Practices\n");
    for (const label of labels) {
      parts.push(`### ${label.name}\n${label.content}\n`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Handle list_available_tasks tool call
 *
 * Returns all PENDING tasks with availability information.
 * A task is available only if:
 * - Status is PENDING
 * - All dependencies are satisfied (COMPLETED or ABANDONED)
 * - Not locked by another session
 */
export async function handleListAvailableTasks(
  ctx: TaskToolContext,
  args: { planId?: string; issueNumber?: number }
): Promise<ToolResponse> {
  const { planId, issueNumber } = args;

  let tasks: ReturnType<typeof ctx.taskRepository.findMany> = [];

  if (planId) {
    tasks = ctx.taskRepository.findByPlanId(planId);
  } else if (issueNumber) {
    const issue = ctx.issueRepository.findByNumber(issueNumber);
    if (issue) {
      const plan = ctx.planRepository.findByIssueId(issue.id);
      if (plan) {
        tasks = ctx.taskRepository.findByPlanId(plan.id);
      }
    }
  } else {
    tasks = ctx.taskRepository.findMany();
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
 * Handle update_task_labels tool call
 */
export async function handleUpdateTaskLabels(
  ctx: TaskToolContext,
  args: { taskId: string; labels: string[] }
): Promise<ToolResponse> {
  const { taskId, labels } = args;

  // Validate labels exist
  if (labels.length > 0) {
    const available = await ctx.labelService.listAvailableLabels();
    const availableSet = new Set(available);
    const invalidLabels = labels.filter((l) => !availableSet.has(l));

    if (invalidLabels.length > 0) {
      return errorResponse(
        `Invalid labels: [${invalidLabels.join(", ")}]. ` +
          `Available: [${available.join(", ")}]`
      );
    }
  }

  const task = ctx.taskRepository.updateLabels(taskId, labels);

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle list_available_task_labels tool call
 */
export async function handleListAvailableTaskLabels(
  ctx: TaskToolContext
): Promise<ToolResponse> {
  const labels = await ctx.labelService.listAvailableLabels();

  return successResponse({
    success: true,
    labels,
    description: "Available labels that can be assigned to tasks",
  });
}

/**
 * Handle get_task_label tool call
 */
export async function handleGetTaskLabel(
  ctx: TaskToolContext,
  args: { name: string }
): Promise<ToolResponse> {
  const { name } = args;

  const label = await ctx.labelService.getLabel(name);
  if (!label) {
    return errorResponse(`Label not found: ${name}`);
  }

  return successResponse({
    success: true,
    label,
  });
}

/**
 * Handle create_task_label tool call
 */
export async function handleCreateTaskLabel(
  ctx: TaskToolContext,
  args: { name: string; content: string }
): Promise<ToolResponse> {
  const { name, content } = args;

  const label = await ctx.labelService.createLabel(name, content);

  return successResponse({
    success: true,
    label,
    message: `Created label "${name}" at .track/labels/${name}.md`,
  });
}

/**
 * Handle update_task_label tool call
 */
export async function handleUpdateTaskLabel(
  ctx: TaskToolContext,
  args: { name: string; content: string }
): Promise<ToolResponse> {
  const { name, content } = args;

  const label = await ctx.labelService.updateLabel(name, content);

  return successResponse({
    success: true,
    label,
    message: `Updated label "${name}"`,
  });
}

/**
 * Handle remove_task_label tool call
 */
export async function handleRemoveTaskLabel(
  ctx: TaskToolContext,
  args: { name: string }
): Promise<ToolResponse> {
  const { name } = args;

  await ctx.labelService.removeLabel(name);

  return successResponse({
    success: true,
    message: `Removed label "${name}"`,
  });
}

/**
 * Handle add_manual_task tool call
 */
export function handleAddManualTask(
  ctx: TaskToolContext,
  args: {
    issueNumber: number;
    title: string;
    description: string;
    acceptanceCriteria?: string[];
    estimatedMinutes?: number;
    insertAfterTaskId?: string;
  }
): ToolResponse {
  const {
    issueNumber,
    title,
    description,
    acceptanceCriteria,
    estimatedMinutes,
    insertAfterTaskId,
  } = args;

  const task = ctx.taskManagementService.addManualTask({
    issueNumber,
    title,
    description,
    acceptanceCriteria,
    estimatedMinutes,
    insertAfterTaskId,
  });

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle delete_task tool call
 */
export function handleDeleteTask(
  ctx: TaskToolContext,
  args: { taskId: string }
): ToolResponse {
  const { taskId } = args;

  const task = ctx.taskManagementService.deleteTask(taskId, "claude-agent");

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle update_task tool call
 */
export async function handleUpdateTask(
  ctx: TaskToolContext,
  args: {
    taskId: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    contextInstructions?: string;
    estimatedMinutes?: number;
    labels?: string[];
  }
): Promise<ToolResponse> {
  const {
    taskId,
    title,
    description,
    acceptanceCriteria,
    contextInstructions,
    estimatedMinutes,
    labels,
  } = args;

  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Validate labels if provided
  if (labels !== undefined && labels.length > 0) {
    const available = await ctx.labelService.listAvailableLabels();
    const availableSet = new Set(available);
    const invalidLabels = labels.filter((l) => !availableSet.has(l));

    if (invalidLabels.length > 0) {
      return errorResponse(
        `Invalid labels: [${invalidLabels.join(", ")}]. ` +
          `Available: [${available.join(", ")}]`
      );
    }
  }

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (acceptanceCriteria !== undefined)
    updates.acceptanceCriteria = acceptanceCriteria;
  if (contextInstructions !== undefined)
    updates.contextInstructions = contextInstructions;
  if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;
  if (labels !== undefined) updates.labels = labels;

  const updatedTask = ctx.taskRepository.update(taskId, updates);

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

  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Get parent context
  const plan = ctx.planRepository.findById(task.planId);
  if (!plan) {
    return errorResponse(`Plan not found for task: ${taskId}`);
  }

  const issue = ctx.issueRepository.findById(plan.issueId);
  if (!issue) {
    return errorResponse(`Issue not found for plan: ${plan.id}`);
  }

  // Generate session ID for the subagent
  const sessionId = crypto.randomUUID();

  // Build the execution prompt
  const issueAcceptanceCriteria = issue.acceptanceCriteria
    .map((c) => `- [ ] ${c}`)
    .join("\n");
  const taskAcceptanceCriteria = task.acceptanceCriteria
    .map((c) => `- [ ] ${c}`)
    .join("\n");

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

${task.contextInstructions ? `## Additional Instructions\n${task.contextInstructions}\n` : ""}
## Execution Instructions

1. Implement the task following the plan's approach
2. Ensure all acceptance criteria are met
3. Use \`log_task_progress\` to record significant steps (for audit trail)
4. When complete: call \`complete_task_session\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
5. If blocked: call \`abandon_task_session\` with:
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

  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Insert execution log entry
  const db = ctx.dbService.getDb();
  const logId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(ctx.taskExecutionLogsSchema)
    .values({
      id: logId,
      taskId,
      sessionId,
      message,
      filesModified: filesModified || null,
      createdAt: now,
    })
    .run();

  return successResponse({
    success: true,
    logId,
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

  const task = ctx.taskRepository.findById(taskId);
  if (!task) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  // Get all execution log entries for this task
  const db = ctx.dbService.getDb();
  const logs = db
    .select()
    .from(ctx.taskExecutionLogsSchema)
    .where(eq(ctx.taskExecutionLogsSchema.taskId, taskId))
    .orderBy(asc(ctx.taskExecutionLogsSchema.createdAt))
    .all();

  const entries = logs.map((log: TaskExecutionLogRow) => ({
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
  const task = ctx.taskRepository.findById(taskId);
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
    response.warningMessage = formatConflictWarnings(result.warnings);
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

/**
 * Task-related MCP tools
 */

import { eq, asc } from "drizzle-orm";
import {
  taskExecutionLogs,
  type SqliteDataSource,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type TaskSessionService,
  type TaskManagementService,
  type TaskExecutionLogRow,
  type ConflictDetectionService,
  type ConflictWarning,
  type TaskGitHubSyncService,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

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
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "abandon_task_session",
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
    description: "Delete a task (soft delete). Only BACKLOG or READY tasks can be deleted.",
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
  dbService: SqliteDataSource;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  taskSessionService: TaskSessionService;
  taskManagementService: TaskManagementService;
  taskExecutionLogsSchema: typeof taskExecutionLogs;
  conflictDetectionService?: ConflictDetectionService;
  /** Optional - for syncing task status changes to GitHub */
  taskGitHubSyncService?: TaskGitHubSyncService;
}

/**
 * Handle load_task_session tool call
 *
 * Loads a task for execution with full context. Starts or resumes the session.
 * Idempotent: if task is already IN_PROGRESS, returns context without restarting.
 *
 * Supports 3 modes:
 * - 'isolated' (default): creates worktree + branch for parallel work
 * - 'branch': creates branch only, checks out in main repo
 * - 'main': works directly on main, skips PR review
 */
export async function handleLoadTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; mode?: "isolated" | "branch" | "main" }
): Promise<ToolResponse> {
  const { taskId, sessionId, mode = "isolated" } = args;

  // Check if task exists
  const existingTask = ctx.taskRepository.findById(taskId);
  if (!existingTask) {
    return errorResponse(`Task not found: ${taskId}`);
  }

  const response: Record<string, unknown> = {
    success: true,
    sessionId,
  };

  // If task is already IN_PROGRESS, just return context without restarting
  if (existingTask.status === "IN_PROGRESS") {
    response.task = existingTask;
    response.resumed = true;

    // Include existing worktree info if available
    if (existingTask.worktreePath) {
      response.worktreePath = existingTask.worktreePath;
      response.branchName = existingTask.branchName;
    }
  } else {
    // Start new session
    const result = await ctx.taskSessionService.startTaskSession({
      taskId,
      sessionId,
      mode,
    });

    response.task = result.task;
    response.startedAt = result.startedAt;

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

    // Sync to GitHub if task has GitHub sync enabled
    if (ctx.taskGitHubSyncService && result.task.githubSync?.githubIssueNumber) {
      try {
        await ctx.taskGitHubSyncService.syncTaskStatus(taskId, "IN_PROGRESS");
      } catch (error) {
        // Log but don't fail - GitHub sync is best effort after local update
        console.warn(`Failed to sync task status to GitHub: ${error}`);
      }

      // Auto-assign the GitHub issue to the configured assignee
      try {
        await ctx.taskGitHubSyncService.assignIssue(taskId);
      } catch (error) {
        // Log but don't fail - assignment is best effort
        console.warn(`Failed to auto-assign GitHub issue: ${error}`);
      }
    }

    // Sync sibling tasks that transitioned from BACKLOG to READY
    // When starting a task, all other BACKLOG tasks in the plan move to READY
    if (ctx.taskGitHubSyncService && result.task.planId) {
      const siblingTasks = ctx.taskRepository.findByPlanId(result.task.planId);
      for (const sibling of siblingTasks) {
        if (
          sibling.id !== taskId &&
          sibling.status === "READY" &&
          sibling.githubSync?.githubIssueNumber
        ) {
          try {
            await ctx.taskGitHubSyncService.syncTaskStatus(sibling.id, "READY");
          } catch (error) {
            console.warn(`Failed to sync sibling task READY status to GitHub: ${error}`);
          }
        }
      }
    }
  }

  // Load full context (same as get_task_for_session)
  const task = response.task as {
    planId: string;
    dependsOn?: string[];
    contextInstructions?: string;
  };

  // Get plan and issue
  const plan = ctx.planRepository.findById(task.planId);
  if (plan) {
    response.plan = plan;
    const issue = ctx.issueRepository.findById(plan.issueId);
    if (issue) {
      response.issue = issue;
    }
  }

  // Load dependency information
  if (task.dependsOn?.length) {
    const dependencies = ctx.taskRepository.findByIds(task.dependsOn);
    response.dependencies = dependencies.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
    }));
  }

  // Find tasks that depend on this one
  const allPlanTasks = ctx.taskRepository.findByPlanId(task.planId);
  const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(taskId));
  if (dependents.length > 0) {
    response.dependents = dependents.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
    }));
  }

  // Format task requirements prominently
  if (task.contextInstructions) {
    response.taskRequirements = formatTaskRequirements(task.contextInstructions);
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
 * Handle abandon_task_session tool call
 *
 * When force=true:
 * - Bypasses session ownership validation
 * - Use when task state has drifted (e.g., session expired but task is still IN_PROGRESS)
 */
export async function handleAbandonTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string; reason?: string; force?: boolean }
): Promise<ToolResponse> {
  const { taskId, sessionId, reason, force = false } = args;

  const task = await ctx.taskSessionService.abandonTaskSession(taskId, sessionId, reason, force);

  // Sync to GitHub if task has GitHub sync enabled
  if (ctx.taskGitHubSyncService && task.githubSync?.githubIssueNumber) {
    try {
      await ctx.taskGitHubSyncService.syncTaskStatus(taskId, "ABANDONED");
    } catch (error) {
      // Log but don't fail - GitHub sync is best effort after local update
      console.warn(`Failed to sync task status to GitHub: ${error}`);
    }
  }

  return successResponse({
    success: true,
    task,
    forced: force,
    message: force ? "Task force-abandoned" : "Task abandoned",
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
    task = ctx.taskRepository.findById(taskId);
  } else if (taskNumber !== undefined && issueNumber !== undefined) {
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
    return errorResponse("Either taskId or both taskNumber and issueNumber are required");
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
  });
}

/**
 * Format task requirements for Claude consumption
 */
function formatTaskRequirements(contextInstructions: string): string {
  return "## Task-Specific Instructions\n" + contextInstructions;
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
 */
export function handleUpdateTask(
  ctx: TaskToolContext,
  args: {
    taskId: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    contextInstructions?: string;
    estimatedMinutes?: number;
    labels?: Record<string, string | null>;
  }
): ToolResponse {
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

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (acceptanceCriteria !== undefined) updates.acceptanceCriteria = acceptanceCriteria;
  if (contextInstructions !== undefined) updates.contextInstructions = contextInstructions;
  if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

  // Handle labels - merge with existing, null values remove labels
  if (labels !== undefined) {
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

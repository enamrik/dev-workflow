/**
 * Task-related MCP tools
 */

import { eq, asc } from "drizzle-orm";
import {
  taskExecutionLogs,
  type DatabaseService,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type TaskSessionService,
  type TaskManagementService,
  type SkillService,
  type Skill,
  type TaskStatus,
  type TaskExecutionLogRow,
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
          enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "ABANDONED"],
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
      "Start working on a task in the current Claude session. Automatically updates status to IN_PROGRESS.",
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
      },
      required: ["taskId", "sessionId"],
    },
  },
  {
    name: "complete_task_session",
    description:
      "Complete the current task. Marks task as COMPLETED.",
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
      "Abandon the current task. Marks task as ABANDONED.",
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
    name: "get_task_for_session",
    description:
      "Get full task details for execution in session. Includes title, description, acceptance criteria, and loaded skills for task labels.",
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
      "Update skill labels for a task. Labels map to skill files in .track/skills/{label}.md.",
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
            'Array of skill labels (e.g., ["db", "api", "security"])',
        },
      },
      required: ["taskId", "labels"],
    },
  },
  {
    name: "list_available_skills",
    description: "List all available skills. Skills are defined in .track/skills/{name}.md files.",
    inputSchema: {
      type: "object",
      properties: {},
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
            "Custom instructions for subagent execution (e.g., 'use existing auth pattern in src/auth')",
        },
        estimatedMinutes: {
          type: "number",
          description: "Estimated time in minutes",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Skill labels",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "get_task_execution_prompt",
    description:
      "Generate a prompt for spawning a subagent to execute a task. Returns prompt-ready text with full context.",
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
      "Log progress during task execution (for subagent audit trail). Call this to record what you're doing.",
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
      "Get the execution log for a task. Use after subagent completion to see what was done.",
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
  skillService: SkillService;
  taskExecutionLogsSchema: typeof taskExecutionLogs;
}

/**
 * Handle update_task_status tool call
 */
export function handleUpdateTaskStatus(
  ctx: TaskToolContext,
  args: { taskId: string; status: TaskStatus; notes?: string }
): ToolResponse {
  const { taskId, status, notes } = args;

  const updatedTask = ctx.taskRepository.updateStatus(
    taskId,
    status,
    "claude-agent",
    notes
  );

  return successResponse(updatedTask);
}

/**
 * Handle start_task_session tool call
 */
export async function handleStartTaskSession(
  ctx: TaskToolContext,
  args: { taskId: string; sessionId: string }
): Promise<ToolResponse> {
  const { taskId, sessionId } = args;

  const result = await ctx.taskSessionService.startTaskSession({
    taskId,
    sessionId,
  });

  return successResponse({
    success: true,
    task: result.task,
    sessionId: result.sessionId,
    startedAt: result.startedAt,
  });
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

  // Load skills based on labels
  if (task.labels?.length) {
    const skills = await ctx.skillService.loadSkillsForLabels(task.labels);
    if (skills.length > 0) {
      result.loadedSkills = skills;
    }
  }

  // Format task requirements prominently
  if (task.contextInstructions || result.loadedSkills) {
    result.taskRequirements = formatTaskRequirements(
      task.contextInstructions,
      result.loadedSkills as Skill[] | undefined
    );
  }

  return successResponse(result);
}

/**
 * Format task requirements for Claude consumption
 */
function formatTaskRequirements(
  contextInstructions: string | undefined,
  skills: Skill[] | undefined
): string {
  const parts: string[] = [];

  if (contextInstructions) {
    parts.push("## Task-Specific Instructions\n" + contextInstructions);
  }

  if (skills?.length) {
    parts.push("## Required Practices\n");
    for (const skill of skills) {
      parts.push(`### ${skill.name}\n${skill.content}\n`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Handle list_available_tasks tool call
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

  // Filter to only available tasks
  const availableTasks = [];
  for (const task of tasks) {
    const isAvailable = await ctx.taskSessionService.isTaskAvailable(task.id);
    if (isAvailable) {
      availableTasks.push(task);
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
export function handleUpdateTaskLabels(
  ctx: TaskToolContext,
  args: { taskId: string; labels: string[] }
): ToolResponse {
  const { taskId, labels } = args;

  const task = ctx.taskRepository.updateLabels(taskId, labels);

  return successResponse({
    success: true,
    task,
  });
}

/**
 * Handle list_available_skills tool call
 */
export async function handleListAvailableSkills(
  ctx: TaskToolContext
): Promise<ToolResponse> {
  const skills = await ctx.skillService.listAvailableSkills();

  return successResponse({
    success: true,
    skills,
    description: "Available skills that can be assigned as labels to tasks",
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
export function handleUpdateTask(
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

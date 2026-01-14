/**
 * Plan-related MCP tools
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import { isIssueInPlanning, type IssueType } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import {
  GeneratePlanSchema,
  GetPlanSchema,
  PauseIssueSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  SyncIssueSchema,
  type GeneratePlanArgs,
  type GetPlanArgs,
  type PauseIssueArgs,
  type MoveIssueToReadyArgs,
  type MoveIssueToBacklogArgs,
  type SyncIssueArgs,
} from "./schemas.js";
import { createMcpHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";

/**
 * Tool definitions for plan operations
 */
export const planToolDefinitions: ToolDefinition[] = [
  {
    name: "generate_plan",
    description:
      "⚠️ Prefer 'dwf-plan-issue' skill for proper workflow. Generates or regenerates an implementation plan for an issue with tasks. Automatically preserves in-progress and completed tasks from previous plan when possible.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
        summary: {
          type: "string",
          description: "Brief summary of the plan",
        },
        approach: {
          type: "string",
          description: "Detailed implementation approach (markdown)",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Short placeholder ID for this task (e.g., 'db', 'api', 'auth'). Used to reference this task in dependsOn. Real UUIDs are generated internally.",
              },
              title: { type: "string" },
              description: { type: "string" },
              type: {
                type: "string",
                description:
                  "Task type (FEATURE, BUG, ENHANCEMENT, TASK, or custom). REQUIRED. Call list_types first to get valid values. Type determines the GitHub label applied when task is synced.",
              },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
              },
              estimatedMinutes: { type: "number" },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description:
                  "Array of placeholder IDs this task depends on. References must match 'id' values of other tasks in this plan.",
              },
              implementationPlan: {
                type: "string",
                description:
                  "Technical implementation details for task execution (e.g., specific patterns to use, file locations). This is for Claude's execution context and is NOT synced to GitHub issues.",
              },
            },
            required: ["id", "title", "description", "type"],
          },
          description:
            "Array of task definitions. Use short placeholder IDs (e.g., 'db', 'api') and reference them in 'dependsOn'. Real UUIDs are generated internally. Each task MUST include a valid 'type' - call list_types first.",
        },
        estimatedComplexity: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
          description: "Estimated complexity of the plan",
        },
      },
      required: ["summary", "approach", "tasks", "estimatedComplexity"],
    },
  },
  {
    name: "get_plan",
    description: "Get the active plan for an issue with tasks",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
      },
    },
  },
  {
    name: "pause_issue",
    description:
      "Pause work on an issue by moving all READY tasks back to BACKLOG. This allows temporarily deactivating a plan. When work resumes (any task is started), the BACKLOG tasks will transition back to READY.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
      },
      required: ["issueNumber"],
    },
  },
  {
    name: "move_issue_to_ready",
    description:
      "Mark an issue as 'next up' by moving all BACKLOG tasks to READY. " +
      "This allows signaling an issue is ready for work without starting any specific task. " +
      "Idempotent: does nothing if tasks are not in BACKLOG state.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
      },
      required: ["issueNumber"],
    },
  },
  {
    name: "move_issue_to_backlog",
    description:
      "Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG. " +
      "Creates GitHub issues for each task (if GitHub sync is enabled). " +
      "This confirms the plan is finalized and makes tasks available for work. " +
      "User must confirm the plan before calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        skipGitHubSync: {
          type: "boolean",
          description:
            "Skip GitHub issue creation even if GitHub sync is enabled. " +
            "Tasks will still transition to BACKLOG but without creating GitHub issues. " +
            "Useful for internal issues that don't need GitHub visibility. Default: false.",
        },
      },
      required: ["issueNumber"],
    },
  },
  {
    name: "sync_issue",
    description:
      "Repair GitHub sync state for an issue. Creates missing GitHub issues for tasks, " +
      "links existing GitHub issues found by title search, and verifies already-synced tasks. " +
      "Idempotent: safe to run multiple times. Use this to recover from partial syncs or errors " +
      "during move_issue_to_backlog. Respects imported vs non-imported issue logic.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
      },
      required: ["issueNumber"],
    },
  },
];

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle generate_plan tool call
 */
async function generatePlanHandler(
  args: unknown,
  {
    project,
    issueService,
    planningService,
    typeService,
  }: Pick<McpCradle, "project" | "issueService" | "planningService" | "typeService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<GeneratePlanArgs>(GeneratePlanSchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber, summary, approach, tasks, estimatedComplexity } = validation.data;

  // Resolve issue from ID or number
  const issue = issueId
    ? issueService.findById(issueId)
    : issueNumber
      ? issueService.findByNumber(issueNumber)
      : null;

  if (!issue) {
    return errorResponse(
      issueId
        ? `Issue not found: ${issueId}`
        : issueNumber
          ? `Issue not found: #${issueNumber}`
          : "Either issueId or issueNumber is required"
    );
  }

  const resolvedIssueId = issue.id;

  // Validate task types - each task must have a valid type
  const validTypes = await typeService.getTypes();
  const validTypeNames = validTypes.map((t) => t.name);

  for (const task of tasks) {
    // Check type is provided
    if (!task.type) {
      return errorResponse(
        `Task '${task.id}' is missing required 'type' field. ` +
          `Valid types: ${validTypeNames.join(", ")}. ` +
          `Call list_types first to get available types.`
      );
    }

    // Check type is valid
    const isValid = await typeService.isValidType(task.type);
    if (!isValid) {
      return errorResponse(
        `Task '${task.id}' has invalid type '${task.type}'. ` +
          `Valid types: ${validTypeNames.join(", ")}. ` +
          `Call list_types first to get available types.`
      );
    }
  }

  // Validate dependsOn references - all must reference existing task IDs
  const taskIds = new Set(tasks.map((t) => t.id));
  for (const task of tasks) {
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        if (!taskIds.has(depId)) {
          return errorResponse(
            `Task '${task.id}' references non-existent dependency '${depId}'. ` +
              `Available task IDs: ${Array.from(taskIds).join(", ")}`
          );
        }
      }
    }
  }

  // Ensure tasks have required fields with defaults
  const normalizedTasks = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type as IssueType, // Validated above
    acceptanceCriteria: t.acceptanceCriteria ?? [],
    estimatedMinutes: t.estimatedMinutes,
    dependsOn: t.dependsOn,
    implementationPlan: t.implementationPlan,
  }));

  const result = await planningService.generatePlan({
    issueId: resolvedIssueId,
    summary,
    approach,
    tasks: normalizedTasks,
    estimatedComplexity,
    generatedBy: "claude-agent",
  });

  return successResponse({
    ...result,
    url: `http://127.0.0.1:3456/projects/${project.slug}/issues/${issue.number}`,
  });
}

/**
 * Handle get_plan tool call
 */
function getPlanHandler(
  args: unknown,
  {
    issueService,
    planService,
    taskService,
  }: Pick<McpCradle, "issueService" | "planService" | "taskService">
): ToolResponse {
  const validation = validateToolArgs<GetPlanArgs>(GetPlanSchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber } = validation.data;

  // Resolve issue ID from number if needed
  let resolvedIssueId = issueId;
  if (!resolvedIssueId && issueNumber) {
    const issue = issueService.findByNumber(issueNumber);
    if (!issue) {
      return errorResponse(`Issue not found: #${issueNumber}`);
    }
    resolvedIssueId = issue.id;
  }

  if (!resolvedIssueId) {
    return errorResponse("Either issueId or issueNumber is required");
  }

  const plan = planService.findByIssueId(resolvedIssueId);
  if (!plan) {
    return errorResponse("No plan found for this issue");
  }

  const tasks = taskService.findByPlanId(plan.id);

  return successResponse({ plan, tasks });
}

/**
 * Handle pause_issue tool call
 *
 * Moves all READY tasks back to BACKLOG, allowing the plan to be
 * temporarily deactivated. When work resumes (any task is started),
 * BACKLOG tasks will transition back to READY.
 */
function pauseIssueHandler(
  args: unknown,
  { planningService }: Pick<McpCradle, "planningService">
): ToolResponse {
  const validation = validateToolArgs<PauseIssueArgs>(PauseIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber } = validation.data;

  const result = planningService.pauseIssue(issueNumber);

  return successResponse({
    message:
      result.count > 0
        ? `Paused issue #${issueNumber}: ${result.count} task(s) moved from READY to BACKLOG`
        : `Issue #${issueNumber} has no READY tasks to pause`,
    tasksMovedCount: result.count,
    tasks: result.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    })),
  });
}

/**
 * Handle move_issue_to_ready tool call
 *
 * Moves all BACKLOG tasks to READY, allowing the user to mark an issue
 * as "next up" without starting any specific task.
 * Idempotent: does nothing if no BACKLOG tasks exist.
 *
 * If GitHub sync is enabled, syncs each task's status to the GitHub Project
 * board (moves to "Ready" column).
 */
async function moveIssueToReadyHandler(
  args: unknown,
  { planningService, taskSyncService }: Pick<McpCradle, "planningService" | "taskSyncService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<MoveIssueToReadyArgs>(MoveIssueToReadySchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber } = validation.data;

  try {
    const result = planningService.readyIssue(issueNumber);

    // Sync each task's READY status to GitHub (if sync enabled)
    if (taskSyncService && result.tasks.length > 0) {
      for (const task of result.tasks) {
        await taskSyncService.syncTaskStatus(task.id, "READY");
      }
    }

    return successResponse({
      message:
        result.count > 0
          ? `Issue #${issueNumber} is ready: ${result.count} task(s) moved from BACKLOG to READY`
          : `Issue #${issueNumber} has no BACKLOG tasks to ready`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(errorMessage);
  }
}

/**
 * Handle move_issue_to_backlog tool call
 *
 * Activates a PLANNED issue and all its PLANNED tasks:
 * - Issue: PLANNED → OPEN
 * - Tasks: PLANNED → BACKLOG
 * - Creates GitHub issues for each task (if sync enabled)
 *
 * This is idempotent: if called on an issue already in OPEN status,
 * it only activates any remaining PLANNED tasks (from a plan regeneration).
 */
async function moveIssueToBacklogHandler(
  args: unknown,
  {
    issueService,
    planService,
    taskService,
    taskSyncService,
  }: Pick<McpCradle, "issueService" | "planService" | "taskService" | "taskSyncService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<MoveIssueToBacklogArgs>(MoveIssueToBacklogSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber, skipGitHubSync = false } = validation.data;

  // Get the issue
  const issue = issueService.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue not found: #${issueNumber}`);
  }

  // Validate issue status
  if (issue.status !== "PLANNED" && issue.status !== "OPEN") {
    return errorResponse(
      `Issue must be PLANNED or OPEN to activate. Current status: ${issue.status}`
    );
  }

  // Get the plan
  const plan = planService.findByIssueId(issue.id);
  if (!plan) {
    return errorResponse(`No plan found for issue #${issueNumber}`);
  }

  // Get PLANNED tasks
  const allTasks = taskService.findByPlanId(plan.id);
  const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

  // If no PLANNED tasks and issue is already active (not in planning), nothing to do
  if (plannedTasks.length === 0 && !isIssueInPlanning(issue)) {
    return successResponse({
      message: `Issue #${issueNumber} is already active with no PLANNED tasks`,
      issueNumber: issue.number,
      issueStatus: issue.status,
      tasksActivated: 0,
      githubIssuesCreated: 0,
    });
  }

  // Use TaskSyncService if available and not skipped
  if (taskSyncService && !skipGitHubSync) {
    try {
      const result = await taskSyncService.activatePlannedTasks(issue.id);

      if (!result.success) {
        return errorResponse(result.error ?? "Failed to activate tasks");
      }

      return successResponse({
        message: `Issue #${issueNumber} activated. ${result.tasksActivated.length} task(s) moved to BACKLOG.`,
        issueNumber: issue.number,
        issueStatus: result.issueTransitioned ? "OPEN" : issue.status,
        issueTransitioned: result.issueTransitioned,
        tasksActivated: result.tasksActivated.length,
        githubIssuesCreated: result.tasksActivated.filter((t) => t.githubIssueNumber).length,
        tasks: result.tasksActivated.map((t) => ({
          taskId: t.taskId,
          taskNumber: t.taskNumber,
          githubIssueNumber: t.githubIssueNumber,
          githubUrl: t.githubUrl,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse(`Failed to activate tasks: ${errorMessage}`);
    }
  }

  // No GitHub sync - just move tasks to BACKLOG
  const activatedTasks = [];
  for (const task of plannedTasks) {
    taskService.updateTaskStatus(
      task.id,
      "BACKLOG",
      "system",
      skipGitHubSync
        ? "Activated via move_issue_to_backlog (GitHub sync skipped)"
        : "Activated via move_issue_to_backlog"
    );
    activatedTasks.push({
      taskId: task.id,
      taskNumber: task.number,
    });
  }

  // Transition issue from PLANNED → OPEN
  const issueTransitioned = isIssueInPlanning(issue);
  if (issueTransitioned) {
    issueService.update(issue.id, { status: "OPEN" });
  }

  return successResponse({
    message: `Issue #${issueNumber} activated. ${activatedTasks.length} task(s) moved to BACKLOG.${skipGitHubSync ? " (GitHub sync skipped)" : ""}`,
    issueNumber: issue.number,
    issueStatus: issueTransitioned ? "OPEN" : issue.status,
    issueTransitioned,
    tasksActivated: activatedTasks.length,
    githubIssuesCreated: 0,
    githubSyncSkipped: skipGitHubSync,
    tasks: activatedTasks,
  });
}

/**
 * Handle sync_issue tool call
 *
 * Repairs GitHub sync state for an issue:
 * - Creates missing GitHub issues for tasks
 * - Links existing GitHub issues found by title search
 * - Verifies already-synced tasks still exist on GitHub
 * - Ensures GitHub Project state is correct
 *
 * Idempotent: safe to run multiple times, produces same result.
 */
async function syncIssueHandler(
  args: unknown,
  { taskSyncService }: Pick<McpCradle, "taskSyncService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<SyncIssueArgs>(SyncIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber } = validation.data;

  if (!taskSyncService) {
    return errorResponse("GitHub sync is not enabled for this project");
  }

  try {
    const result = await taskSyncService.syncIssue(issueNumber);

    if (!result.success && result.errors.length > 0) {
      // Partial failure - some tasks had errors
      const errorMessages = result.errors.map((e) => e.error).join("; ");
      return errorResponse(`Sync completed with errors: ${errorMessages}`);
    }

    // Build summary message
    const parts: string[] = [];
    if (result.created.length > 0) {
      parts.push(`${result.created.length} created`);
    }
    if (result.linked.length > 0) {
      parts.push(`${result.linked.length} linked`);
    }
    if (result.verified.length > 0) {
      parts.push(`${result.verified.length} verified`);
    }
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} skipped`);
    }

    const summary = parts.length > 0 ? parts.join(", ") : "no tasks to sync";

    return successResponse({
      message: `Issue #${issueNumber} sync complete: ${summary}`,
      issueNumber: result.issueNumber,
      tasksProcessed: result.tasksProcessed,
      created: result.created.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber,
        githubUrl: t.githubUrl,
      })),
      linked: result.linked.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber,
        githubUrl: t.githubUrl,
      })),
      verified: result.verified.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber,
        githubUrl: t.githubUrl,
      })),
      skipped: result.skipped.map((t) => ({
        taskNumber: t.taskNumber,
        reason: t.error,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to sync issue: ${errorMessage}`);
  }
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleGeneratePlan = createMcpHandler(generatePlanHandler);
export const handleGetPlan = createMcpHandler(getPlanHandler);
export const handlePauseIssue = createMcpHandler(pauseIssueHandler);
export const handleMoveIssueToReady = createMcpHandler(moveIssueToReadyHandler);
export const handleMoveIssueToBacklog = createMcpHandler(moveIssueToBacklogHandler);
export const handleSyncIssue = createMcpHandler(syncIssueHandler);

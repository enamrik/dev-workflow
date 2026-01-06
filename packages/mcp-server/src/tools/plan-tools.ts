/**
 * Plan-related MCP tools
 */

import type {
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  PlanningService,
  PlanComplexity,
  TaskGitHubSyncService,
  Project,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

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
            },
            required: ["id", "title", "description"],
          },
          description:
            "Array of task definitions. Use short placeholder IDs (e.g., 'db', 'api') and reference them in 'dependsOn'. Real UUIDs are generated internally.",
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

/**
 * Service context for plan handlers
 */
export interface PlanToolContext {
  /** Current project (for URL construction) */
  project: Project;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  planningService: PlanningService;
  taskGitHubSyncService?: TaskGitHubSyncService; // Optional - only present if GitHub sync is enabled
}

/**
 * Task definition for plan generation
 *
 * The 'id' field is a short placeholder (e.g., "db", "api") used to reference
 * this task in dependsOn arrays. Real UUIDs are generated internally by the
 * PlanningService.
 */
interface TaskDefinition {
  id: string; // Short placeholder ID (e.g., "db", "api", "auth")
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
  dependsOn?: string[]; // Placeholder IDs of tasks this depends on
}

/**
 * Handle generate_plan tool call
 */
export async function handleGeneratePlan(
  ctx: PlanToolContext,
  args: {
    issueId?: string;
    issueNumber?: number;
    summary: string;
    approach: string;
    tasks: TaskDefinition[];
    estimatedComplexity: PlanComplexity;
  }
): Promise<ToolResponse> {
  const { issueId, issueNumber, summary, approach, tasks, estimatedComplexity } = args;

  // Resolve issue from ID or number
  const issue = issueId
    ? ctx.issueRepository.findById(issueId)
    : issueNumber
      ? ctx.issueRepository.findByNumber(issueNumber)
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
    acceptanceCriteria: t.acceptanceCriteria ?? [],
    estimatedMinutes: t.estimatedMinutes,
    dependsOn: t.dependsOn,
  }));

  const result = await ctx.planningService.generatePlan({
    issueId: resolvedIssueId,
    summary,
    approach,
    tasks: normalizedTasks,
    estimatedComplexity,
    generatedBy: "claude-agent",
  });

  return successResponse({
    ...result,
    url: `http://127.0.0.1:3456/projects/${ctx.project.slug}/issues/${issue.number}`,
  });
}

/**
 * Handle get_plan tool call
 */
export function handleGetPlan(
  ctx: PlanToolContext,
  args: { issueId?: string; issueNumber?: number }
): ToolResponse {
  const { issueId, issueNumber } = args;

  // Resolve issue ID from number if needed
  let resolvedIssueId = issueId;
  if (!resolvedIssueId && issueNumber) {
    const issue = ctx.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      return errorResponse(`Issue not found: #${issueNumber}`);
    }
    resolvedIssueId = issue.id;
  }

  if (!resolvedIssueId) {
    return errorResponse("Either issueId or issueNumber is required");
  }

  const plan = ctx.planRepository.findByIssueId(resolvedIssueId);
  if (!plan) {
    return errorResponse("No plan found for this issue");
  }

  const tasks = ctx.taskRepository.findByPlanId(plan.id);

  return successResponse({ plan, tasks });
}

/**
 * Handle pause_issue tool call
 *
 * Moves all READY tasks back to BACKLOG, allowing the plan to be
 * temporarily deactivated. When work resumes (any task is started),
 * BACKLOG tasks will transition back to READY.
 */
export function handlePauseIssue(
  ctx: PlanToolContext,
  args: { issueNumber: number }
): ToolResponse {
  const { issueNumber } = args;

  if (!issueNumber) {
    return errorResponse("issueNumber is required");
  }

  const result = ctx.planningService.pauseIssue(issueNumber);

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
export async function handleMoveIssueToReady(
  ctx: PlanToolContext,
  args: { issueNumber: number }
): Promise<ToolResponse> {
  const { issueNumber } = args;

  if (!issueNumber) {
    return errorResponse("issueNumber is required");
  }

  try {
    const result = ctx.planningService.readyIssue(issueNumber);

    // Sync each task's READY status to GitHub (if sync enabled)
    if (ctx.taskGitHubSyncService && result.tasks.length > 0) {
      for (const task of result.tasks) {
        await ctx.taskGitHubSyncService.syncTaskStatus(task.id, "READY");
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
export async function handleMoveIssueToBacklog(
  ctx: PlanToolContext,
  args: { issueNumber: number; skipGitHubSync?: boolean }
): Promise<ToolResponse> {
  const { issueNumber, skipGitHubSync = false } = args;

  if (!issueNumber) {
    return errorResponse("issueNumber is required");
  }

  // Get the issue
  const issue = ctx.issueRepository.findByNumber(issueNumber);
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
  const plan = ctx.planRepository.findByIssueId(issue.id);
  if (!plan) {
    return errorResponse(`No plan found for issue #${issueNumber}`);
  }

  // Get PLANNED tasks
  const allTasks = ctx.taskRepository.findByPlanId(plan.id);
  const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

  // If no PLANNED tasks and issue is already OPEN, nothing to do
  if (plannedTasks.length === 0 && issue.status === "OPEN") {
    return successResponse({
      message: `Issue #${issueNumber} is already active with no PLANNED tasks`,
      issueNumber: issue.number,
      issueStatus: issue.status,
      tasksActivated: 0,
      githubIssuesCreated: 0,
    });
  }

  // Use TaskGitHubSyncService if available and not skipped
  if (ctx.taskGitHubSyncService && !skipGitHubSync) {
    try {
      const result = await ctx.taskGitHubSyncService.activatePlannedTasks(issue.id);

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
    ctx.taskRepository.updateStatus(
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
  const issueTransitioned = issue.status === "PLANNED";
  if (issueTransitioned) {
    ctx.issueRepository.update(issue.id, { status: "OPEN" });
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
export async function handleSyncIssue(
  ctx: PlanToolContext,
  args: { issueNumber: number }
): Promise<ToolResponse> {
  const { issueNumber } = args;

  if (!issueNumber) {
    return errorResponse("issueNumber is required");
  }

  if (!ctx.taskGitHubSyncService) {
    return errorResponse("GitHub sync is not enabled for this project");
  }

  try {
    const result = await ctx.taskGitHubSyncService.syncIssue(issueNumber);

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

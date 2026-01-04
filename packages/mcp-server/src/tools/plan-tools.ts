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
        preserveExistingTasks: {
          type: "boolean",
          description: "Try to preserve in-progress/completed tasks (default: true)",
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
      },
      required: ["issueNumber"],
    },
  },
];

/**
 * Service context for plan handlers
 */
export interface PlanToolContext {
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
    preserveExistingTasks?: boolean;
  }
): Promise<ToolResponse> {
  const {
    issueId,
    issueNumber,
    summary,
    approach,
    tasks,
    estimatedComplexity,
    preserveExistingTasks = true,
  } = args;

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
    preserveExistingTasks,
  });

  return successResponse({
    ...result,
    url: `http://127.0.0.1:3456/projects/${issue.projectId}/issues/${issue.number}`,
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
  args: { issueNumber: number }
): Promise<ToolResponse> {
  const { issueNumber } = args;

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

  // Use TaskGitHubSyncService if available
  if (ctx.taskGitHubSyncService) {
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
      "Activated via move_issue_to_backlog"
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
    message: `Issue #${issueNumber} activated. ${activatedTasks.length} task(s) moved to BACKLOG.`,
    issueNumber: issue.number,
    issueStatus: issueTransitioned ? "OPEN" : issue.status,
    issueTransitioned,
    tasksActivated: activatedTasks.length,
    githubIssuesCreated: 0, // No GitHub sync
    tasks: activatedTasks,
  });
}

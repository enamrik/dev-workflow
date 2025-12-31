/**
 * Plan-related MCP tools
 */

import type {
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  PlanningService,
  PlanComplexity,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

/**
 * Tool definitions for plan operations
 */
export const planToolDefinitions: ToolDefinition[] = [
  {
    name: "generate_plan",
    description:
      "Generate or regenerate an implementation plan for an issue with tasks. Automatically preserves in-progress and completed tasks from previous plan when possible.",
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
              title: { type: "string" },
              description: { type: "string" },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
              },
              estimatedMinutes: { type: "number" },
            },
            required: ["title", "description"],
          },
          description: "Array of task definitions",
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
];

/**
 * Service context for plan handlers
 */
export interface PlanToolContext {
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  planningService: PlanningService;
}

/**
 * Task definition for plan generation
 */
interface TaskDefinition {
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
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

  // Ensure tasks have required fields with defaults
  const normalizedTasks = tasks.map((t) => ({
    title: t.title,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria ?? [],
    estimatedMinutes: t.estimatedMinutes,
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

  return successResponse(result);
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

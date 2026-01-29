/**
 * PR Tool Definitions
 *
 * MCP tool definitions and handler functions for GitHub PR operations.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import {
  GetTaskPRStatusSchema,
  CreatePRSchema,
  SubmitForReviewSchema,
  CompleteTaskSchema,
} from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { PRTool } from "./pr-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const prToolDefinitions: ToolDefinition[] = [
  {
    name: "get_task_pr_status",
    description: "Get the PR status for a task. Returns PR details if one exists.",
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
    name: "create_pr",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Create a PR for a task. Pushes branch and creates PR with GitHub issue linking. " +
      "Does NOT change task status (stays IN_PROGRESS). Use submit_for_review afterward to transition to PR_REVIEW. " +
      "Task must be IN_PROGRESS with a worktree/branch. " +
      "Use force=true to bypass status validation when task state has drifted. " +
      "Claude MUST ask user permission before using force=true.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        title: {
          type: "string",
          description:
            "PR title. Defaults to '[#N] taskTitle' where N is the task's linked GitHub issue number. Plain 'taskTitle' if task has no GitHub issue.",
        },
        body: {
          type: "string",
          description: "PR body/description. GitHub issue linking is automatically added.",
        },
        draft: {
          type: "boolean",
          description: "Create as draft PR (default: false)",
        },
        baseBranch: {
          type: "string",
          description: "Target branch for the PR (default: main)",
        },
        force: {
          type: "boolean",
          description:
            "Bypass status validation. Use when task state has drifted " +
            "(e.g., branch already pushed but task not in IN_PROGRESS). " +
            "Claude MUST ask user permission before using force=true.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "submit_for_review",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Submit a task for review. Transitions task status from IN_PROGRESS to PR_REVIEW and syncs to GitHub. " +
      "Task must have a PR created via create_pr first. " +
      "Use force=true to bypass validation when task state has drifted. " +
      "Claude MUST ask user permission before using force=true.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task UUID",
        },
        force: {
          type: "boolean",
          description:
            "Bypass status/PR validation. Use when task state has drifted " +
            "(e.g., task already in PR_REVIEW but needs re-sync). " +
            "Claude MUST ask user permission before using force=true.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description:
      "⚠️ Prefer 'dwf-work-task' skill for proper workflow. " +
      "Complete a task after PR is merged. Atomically: verifies PR is merged, pulls main, " +
      "cleans up worktree/branch, transitions status to COMPLETED. " +
      "Task must be in PR_REVIEW status with a merged PR. " +
      "Use force=true to bypass state validation when task state has drifted (e.g., PR already merged but task status is wrong).",
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
        finalLogEntry: {
          type: "string",
          description:
            "Required summary of what was accomplished in this task. " +
            "This is written to the task execution log before completing.",
        },
        force: {
          type: "boolean",
          description:
            "Bypass state machine validation. Use when task state has drifted from reality " +
            "(e.g., task is IN_PROGRESS but PR is already merged). Requires user confirmation before use.",
        },
        autoCloseIssue: {
          type: "boolean",
          description:
            "When true, automatically close the parent issue if all tasks are now in terminal state " +
            "(COMPLETED or ABANDONED). Default: false. Claude should ask user permission before using this.",
        },
      },
      required: ["taskId", "sessionId", "finalLogEntry"],
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle get_task_pr_status tool call
 */
export const handleGetTaskPRStatus = createMcpHandler(
  async (args: unknown, { prTool }: { prTool: PRTool }) => {
    const validated = validateSchema(GetTaskPRStatusSchema, args);
    const result = await prTool.getTaskPRStatus(validated);
    return successResponse(result);
  }
);

/**
 * Handle create_pr tool call
 */
export const handleCreatePR = createMcpHandler(
  async (args: unknown, { prTool }: { prTool: PRTool }) => {
    const validated = validateSchema(CreatePRSchema, args);
    const result = await prTool.createPR(validated);
    return successResponse(result);
  }
);

/**
 * Handle submit_for_review tool call
 */
export const handleSubmitForReview = createMcpHandler(
  async (args: unknown, { prTool }: { prTool: PRTool }) => {
    const validated = validateSchema(SubmitForReviewSchema, args);
    const result = await prTool.submitForReview(validated);
    return successResponse(result);
  }
);

/**
 * Handle complete_task tool call
 */
export const handleCompleteTask = createMcpHandler(
  async (args: unknown, { prTool }: { prTool: PRTool }) => {
    const validated = validateSchema(CompleteTaskSchema, args);
    const result = await prTool.completeTask(validated);
    return successResponse(result);
  }
);

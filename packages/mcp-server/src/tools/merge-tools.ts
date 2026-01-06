/**
 * Merge-related MCP tools
 *
 * Provides the merge_issues tool for combining two issues into one.
 */

import {
  MergeService,
  MergeValidationError,
  type MergeMode,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type SqliteProjectRepository,
  type VersioningService,
  type GitHubCLI,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Tool definitions for merge operations
 */
export const mergeToolDefinitions: ToolDefinition[] = [
  {
    name: "merge_issues",
    description:
      "Merge two issues into one. Supports two modes: " +
      "'create_new' creates a fresh issue combining both sources (originals unchanged), " +
      "'merge_into' folds source into target (source is soft-deleted). " +
      "Tasks from both issues are copied/moved to the result. " +
      "Returns warnings for any in-progress or PR-review tasks.",
    inputSchema: {
      type: "object",
      properties: {
        sourceIssueNumber: {
          type: "number",
          description: "Issue number of the source issue (the one being merged from)",
        },
        targetIssueNumber: {
          type: "number",
          description:
            "Issue number of the target issue (in merge_into mode, source folds into this)",
        },
        mode: {
          type: "string",
          enum: ["create_new", "merge_into"],
          description:
            "'create_new': Create a new issue from both (originals unchanged). " +
            "'merge_into': Fold source into target (source is soft-deleted).",
        },
        newTitle: {
          type: "string",
          description: "Custom title for the merged issue (create_new mode only, optional)",
        },
        newDescription: {
          type: "string",
          description: "Custom description for the merged issue (create_new mode only, optional)",
        },
      },
      required: ["sourceIssueNumber", "targetIssueNumber", "mode"],
    },
  },
];

/**
 * Service context for merge handlers
 */
export interface MergeToolContext {
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  projectRepository: SqliteProjectRepository;
  versioningService: VersioningService;
  projectId: string;
  githubCLI: GitHubCLI;
}

/**
 * Arguments for merge_issues tool
 */
interface MergeIssuesArgs {
  sourceIssueNumber: number;
  targetIssueNumber: number;
  mode: MergeMode;
  newTitle?: string;
  newDescription?: string;
}

/**
 * Handle merge_issues tool call
 *
 * Creates a MergeService instance and executes the merge operation.
 * Returns structured result with the merged issue, task count, and any warnings.
 */
export async function handleMergeIssues(
  ctx: MergeToolContext,
  args: MergeIssuesArgs
): Promise<ToolResponse> {
  const { sourceIssueNumber, targetIssueNumber, mode, newTitle, newDescription } = args;

  // Validate mode
  if (mode !== "create_new" && mode !== "merge_into") {
    return errorResponse(`Invalid mode: ${mode}. Must be 'create_new' or 'merge_into'.`);
  }

  // Create MergeService with all dependencies
  const mergeService = new MergeService(
    ctx.issueRepository,
    ctx.planRepository,
    ctx.taskRepository,
    ctx.versioningService,
    ctx.projectRepository,
    ctx.projectId,
    ctx.githubCLI
  );

  try {
    const result = await mergeService.merge({
      sourceIssueNumber,
      targetIssueNumber,
      mode,
      newTitle,
      newDescription,
      mergedBy: "claude-code",
    });

    // Build response with key information
    return successResponse({
      success: true,
      resultIssueNumber: result.resultIssue.number,
      resultIssueId: result.resultIssue.id,
      resultIssueTitle: result.resultIssue.title,
      mergedTaskCount: result.resultTasks.length,
      mode: result.mode,
      sourceIssues: result.sourceIssues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        status: issue.status,
        isDeleted: issue.isDeleted,
      })),
      warnings:
        result.warnings.length > 0
          ? result.warnings.map((w) => ({
              type: w.type,
              message: w.message,
              taskTitle: w.taskTitle,
              issueNumber: w.issueNumber,
            }))
          : undefined,
      message:
        result.mode === "create_new"
          ? `Created new issue #${result.resultIssue.number} by merging #${sourceIssueNumber} and #${targetIssueNumber}`
          : `Merged issue #${sourceIssueNumber} into #${targetIssueNumber}`,
    });
  } catch (error) {
    if (error instanceof MergeValidationError) {
      return errorResponse(error.message);
    }
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

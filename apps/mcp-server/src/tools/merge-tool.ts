/**
 * MergeTool - Issue merge operations
 *
 * Provides operations for combining two issues into one.
 */

import { MergeValidationError, type MergeService } from "@dev-workflow/tracking";

// =============================================================================
// Types
// =============================================================================

export interface MergeIssuesInput {
  sourceIssueNumber: number;
  targetIssueNumber: number;
  mode: "create_new" | "merge_into";
  newTitle?: string;
  newDescription?: string;
}

export interface MergeIssuesResult {
  success: boolean;
  resultIssueNumber: number;
  resultIssueId: string;
  resultIssueTitle: string;
  mergedTaskCount: number;
  mode: "create_new" | "merge_into";
  sourceIssues: Array<{
    number: number;
    title: string;
    status: string;
    isDeleted: boolean;
  }>;
  warnings?: Array<{
    type: string;
    message: string;
    taskTitle: string;
    issueNumber: number;
  }>;
  message: string;
}

// =============================================================================
// MergeTool Class
// =============================================================================

export class MergeTool {
  constructor(private readonly mergeService: MergeService) {}

  /**
   * Merge two issues into one.
   * Supports 'create_new' (creates fresh issue) or 'merge_into' (folds source into target).
   */
  async merge(input: MergeIssuesInput): Promise<MergeIssuesResult> {
    const { sourceIssueNumber, targetIssueNumber, mode, newTitle, newDescription } = input;

    // Validate mode
    if (mode !== "create_new" && mode !== "merge_into") {
      throw new Error(`Invalid mode: ${mode}. Must be 'create_new' or 'merge_into'.`);
    }

    try {
      const result = await this.mergeService.merge({
        sourceIssueNumber,
        targetIssueNumber,
        mode,
        newTitle,
        newDescription,
        mergedBy: "claude-code",
      });

      // Build response with key information
      return {
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
          isDeleted: issue.isDeleted ?? false,
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
      };
    } catch (error) {
      if (error instanceof MergeValidationError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }
}

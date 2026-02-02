/**
 * mergeIssues - Merge two issues into one
 *
 * Supports 'create_new' (fresh issue) or 'merge_into' (fold source into target).
 * Tasks from both issues are copied/moved to the result.
 */

import { z } from "zod";
import { MergeService, MergeValidationError } from "../../domain/issues/merge-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const MergeIssuesSchema = z.object({
  sourceIssueNumber: z.number(),
  targetIssueNumber: z.number(),
  mode: z.enum(["create_new", "merge_into"]),
  newTitle: z.string().optional(),
  newDescription: z.string().optional(),
});
export type MergeIssuesInput = z.infer<typeof MergeIssuesSchema>;

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
// Operation
// =============================================================================

export function mergeIssues(input: MergeIssuesInput) {
  return Effect.gen(function* () {
    const { sourceIssueNumber, targetIssueNumber, mode, newTitle, newDescription } = validateInput(
      MergeIssuesSchema,
      input
    );
    const mergeService = yield* MergeService;

    try {
      const result = yield* Effect.promise(() =>
        mergeService.merge({
          sourceIssueNumber,
          targetIssueNumber,
          mode,
          newTitle,
          newDescription,
          mergedBy: "claude-code",
        })
      );

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
      } satisfies MergeIssuesResult;
    } catch (error) {
      if (error instanceof MergeValidationError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });
}

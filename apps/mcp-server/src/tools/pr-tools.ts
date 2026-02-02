/**
 * PR Tool Schemas and Handlers
 *
 * Colocated Zod schemas with their MCP handlers.
 * Each handler validates via createMcpHandler(schema, handler).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { getTaskPRStatus, createPR, submitForReview, completeTask } from "@dev-workflow/tracking";

// =============================================================================
// Schemas
// =============================================================================

export const GetTaskPRStatusSchema = z.object({
  taskId: z.string().describe("Task UUID"),
});

export const CreatePRSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  title: z
    .string()
    .optional()
    .describe(
      "PR title. Defaults to '[#N] taskTitle' where N is the task's linked GitHub issue number. Plain 'taskTitle' if task has no GitHub issue."
    ),
  body: z
    .string()
    .optional()
    .describe("PR body/description. GitHub issue linking is automatically added."),
  draft: z.boolean().optional().default(false).describe("Create as draft PR (default: false)"),
  baseBranch: z.string().optional().describe("Target branch for the PR (default: main)"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Bypass status validation. Use when task state has drifted (e.g., branch already pushed but task not in IN_PROGRESS). Claude MUST ask user permission before using force=true."
    ),
});

export const SubmitForReviewSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Bypass status/PR validation. Use when task state has drifted (e.g., task already in PR_REVIEW but needs re-sync). Claude MUST ask user permission before using force=true."
    ),
});

export const CompleteTaskSchema = z.object({
  taskId: z.string().describe("Task UUID"),
  sessionId: z.string().describe("Claude session ID"),
  finalLogEntry: z
    .string()
    .describe(
      "Required summary of what was accomplished in this task. This is written to the task execution log before completing."
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Bypass state machine validation. Use when task state has drifted from reality (e.g., task is IN_PROGRESS but PR is already merged). Requires user confirmation before use."
    ),
  autoCloseIssue: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, automatically close the parent issue if all tasks are now in terminal state (COMPLETED or ABANDONED). Default: false. Claude should ask user permission before using this."
    ),
});

// =============================================================================
// Handler Implementations
// =============================================================================

export const handleGetTaskPRStatus = createMcpHandler({
  schema: GetTaskPRStatusSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getTaskPRStatus(args));
    }),
});

export const handleCreatePR = createMcpHandler({
  schema: CreatePRSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* createPR(args));
    }),
});

export const handleSubmitForReview = createMcpHandler({
  schema: SubmitForReviewSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* submitForReview(args));
    }),
});

export const handleCompleteTask = createMcpHandler({
  schema: CompleteTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* completeTask(args));
    }),
});

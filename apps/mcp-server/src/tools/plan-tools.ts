/**
 * Plan Tool Schemas and Handlers
 *
 * Colocated Zod schemas with their MCP handlers.
 * Each handler validates via createMcpHandler(schema, handler).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { ProjectSlug } from "../di/project-slug.js";
import {
  generatePlan,
  getPlan,
  pauseIssue,
  moveIssueToReady,
  moveIssueToBacklog,
  repairIssue,
} from "@dev-workflow/tracking";

// =============================================================================
// Local Enums
// =============================================================================

const PlanComplexityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);

// =============================================================================
// Schemas
// =============================================================================

export const TaskDefinitionSchema = z.object({
  id: z
    .string()
    .describe(
      "Short placeholder ID for this task (e.g., 'db', 'api', 'auth'). Used to reference this task in dependsOn. Real UUIDs are generated internally."
    ),
  title: z.string(),
  description: z.string(),
  type: z
    .string()
    .describe(
      "Task type (FEATURE, BUG, ENHANCEMENT, TASK, or custom). REQUIRED. Call list_types first to get valid values. Type determines the GitHub label applied when task is synced."
    ),
  acceptanceCriteria: z.array(z.string()).optional(),
  estimatedMinutes: z.number().optional(),
  implementationPlan: z
    .string()
    .optional()
    .describe(
      "Technical implementation details for task execution (e.g., specific patterns to use, file locations). This is for Claude's execution context and is NOT synced to GitHub issues."
    ),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe(
      "Array of placeholder IDs this task depends on. References must match 'id' values of other tasks in this plan."
    ),
});

export const GeneratePlanSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
  summary: z.string().describe("Brief summary of the plan"),
  approach: z.string().describe("Detailed implementation approach (markdown)"),
  tasks: z
    .array(TaskDefinitionSchema)
    .describe(
      "Array of task definitions. Use short placeholder IDs (e.g., 'db', 'api') and reference them in 'dependsOn'. Real UUIDs are generated internally. Each task MUST include a valid 'type' - call list_types first."
    ),
  estimatedComplexity: PlanComplexityEnum.describe("Estimated complexity of the plan"),
});

export const GetPlanSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const PauseIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

export const MoveIssueToReadySchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

export const MoveIssueToBacklogSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  skipGitHubSync: z
    .boolean()
    .optional()
    .describe(
      "Skip GitHub issue creation even if GitHub sync is enabled. Tasks will still transition to BACKLOG but without creating GitHub issues. Useful for internal issues that don't need GitHub visibility. Default: false."
    ),
});

export const SyncIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
});

// =============================================================================
// Handler Implementations
// =============================================================================

export const handleGeneratePlan = createMcpHandler({
  schema: GeneratePlanSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* generatePlan({ ...args, projectSlug }));
    }),
});

export const handleGetPlan = createMcpHandler({
  schema: GetPlanSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getPlan(args));
    }),
});

export const handlePauseIssue = createMcpHandler({
  schema: PauseIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* pauseIssue(args));
    }),
});

export const handleMoveIssueToReady = createMcpHandler({
  schema: MoveIssueToReadySchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* moveIssueToReady(args));
    }),
});

export const handleMoveIssueToBacklog = createMcpHandler({
  schema: MoveIssueToBacklogSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* moveIssueToBacklog(args));
    }),
});

export const handleSyncIssue = createMcpHandler({
  schema: SyncIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* repairIssue(args));
    }),
});

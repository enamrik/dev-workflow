/**
 * Plan Tool Handlers
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler validates args and delegates to PlanTool.
 *
 * Tool definitions are in tool-definitions.ts (generated from Zod schemas).
 */

import { successResponse } from "./types.js";
import {
  GeneratePlanSchema,
  GetPlanSchema,
  PauseIssueSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  SyncIssueSchema,
} from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { PlanTool } from "./plan-tool.js";

// =============================================================================
// Handler Implementations
// =============================================================================

export const handleGeneratePlan = createMcpHandler(
  async (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(GeneratePlanSchema, args);
    const result = await planTool.generatePlan(validated);
    return successResponse(result);
  }
);

export const handleGetPlan = createMcpHandler(
  (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(GetPlanSchema, args);
    const result = planTool.getPlan(validated);
    return successResponse(result);
  }
);

export const handlePauseIssue = createMcpHandler(
  (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(PauseIssueSchema, args);
    const result = planTool.pauseIssue(validated);
    return successResponse(result);
  }
);

export const handleMoveIssueToReady = createMcpHandler(
  async (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(MoveIssueToReadySchema, args);
    const result = await planTool.moveIssueToReady(validated);
    return successResponse(result);
  }
);

export const handleMoveIssueToBacklog = createMcpHandler(
  async (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(MoveIssueToBacklogSchema, args);
    const result = await planTool.moveIssueToBacklog(validated);
    return successResponse(result);
  }
);

export const handleSyncIssue = createMcpHandler(
  async (args: unknown, { planTool }: { planTool: PlanTool }) => {
    const validated = validateSchema(SyncIssueSchema, args);
    const result = await planTool.syncIssue(validated);
    return successResponse(result);
  }
);

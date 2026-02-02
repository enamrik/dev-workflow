/**
 * Dispatch tool schemas and handlers
 *
 * Pattern:
 * - Schemas define the MCP input validation (colocated with handlers)
 * - Handlers are thin wrappers: validate + delegate + return success
 * - createMcpHandler wraps with error handling and schema validation
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { createMcpHandler } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { dispatchTask, getDispatchStatus, endWorkerSession } from "@dev-workflow/tracking";
import { ProjectSlug } from "../di/project-slug.js";

// =============================================================================
// Schemas
// =============================================================================

export const DispatchTaskSchema = z.object({
  taskId: z.string().describe("Task UUID to dispatch to workers"),
});

export const GetDispatchStatusSchema = z.object({});

export const EndWorkerSessionSchema = z.object({
  workerId: z.string().describe("Worker UUID (provided in the worker prompt)"),
  taskId: z.string().describe("Task UUID that was being worked on"),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleDispatchTask = createMcpHandler({
  schema: DispatchTaskSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* dispatchTask({ ...args, projectSlug }));
    }),
});

export const handleGetDispatchStatus = createMcpHandler({
  schema: GetDispatchStatusSchema,
  handler: (_args) =>
    Effect.gen(function* () {
      return successResponse(yield* getDispatchStatus());
    }),
});

export const handleEndWorkerSession = createMcpHandler({
  schema: EndWorkerSessionSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* endWorkerSession(args));
    }),
});

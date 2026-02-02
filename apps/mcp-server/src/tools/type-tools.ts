/**
 * Type tool schemas and handlers
 *
 * Pattern:
 * - Schemas define the MCP input validation (colocated with handlers)
 * - Handlers call operations directly (no tool class intermediary)
 * - createMcpHandler wraps with error handling and schema validation
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { Effect } from "@dev-workflow/effect";
import { createMcpHandler } from "../di/bootstrap.js";
import { listTypes, createType, updateType, deleteType } from "@dev-workflow/tracking";

// =============================================================================
// Schemas
// =============================================================================

export const ListTypesSchema = z.object({});

export const CreateTypeSchema = z.object({
  name: z
    .string()
    .describe(
      "Uppercase type name (e.g., 'EPIC', 'TECH_DEBT'). Must be uppercase letters, numbers, and underscores."
    ),
  displayName: z.string().describe("Human-readable display name (e.g., 'Epic', 'Tech Debt')"),
  description: z.string().describe("Description explaining when to use this type"),
  keywords: z
    .array(z.string())
    .optional()
    .describe("Keywords for intelligent type selection (optional)"),
  color: z.string().optional().describe("Optional UI color (hex string, e.g., '#ff0000')"),
});

export const UpdateTypeSchema = z.object({
  name: z.string().describe("Type name to update (e.g., 'FEATURE')"),
  updates: z
    .object({
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
      keywords: z.array(z.string()).optional().describe("New keywords array"),
      color: z.string().nullable().optional().describe("New color (or null to clear)"),
    })
    .describe("Fields to update"),
});

export const DeleteTypeSchema = z.object({
  name: z.string().describe("Type name to delete (e.g., 'SPIKE')"),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleListTypes = createMcpHandler({
  schema: ListTypesSchema,
  handler: (_args) =>
    Effect.gen(function* () {
      return successResponse(yield* listTypes());
    }),
});

export const handleCreateType = createMcpHandler({
  schema: CreateTypeSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* createType(args));
    }),
});

export const handleUpdateType = createMcpHandler({
  schema: UpdateTypeSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* updateType(args));
    }),
});

export const handleDeleteType = createMcpHandler({
  schema: DeleteTypeSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* deleteType(args));
    }),
});

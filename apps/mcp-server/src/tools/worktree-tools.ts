/**
 * Worktree tool schemas and handlers
 *
 * Schemas define the MCP input validation (colocated with handlers).
 * Handlers call operations directly (no tool class intermediary).
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { Effect } from "@dev-workflow/effect";
import { createMcpHandler } from "../di/bootstrap.js";
import { listWorktrees, pruneStaleWorktrees } from "@dev-workflow/tracking";

// =============================================================================
// Schemas
// =============================================================================

export const ListWorktreesSchema = z.object({});

export const PruneStaleWorktreesSchema = z.object({});

// =============================================================================
// Handlers
// =============================================================================

export const handleListWorktrees = createMcpHandler({
  schema: ListWorktreesSchema,
  handler: (_args) =>
    Effect.gen(function* () {
      return successResponse(yield* listWorktrees());
    }),
});

export const handlePruneStaleWorktrees = createMcpHandler({
  schema: PruneStaleWorktreesSchema,
  handler: (_args) =>
    Effect.gen(function* () {
      return successResponse(yield* pruneStaleWorktrees());
    }),
});

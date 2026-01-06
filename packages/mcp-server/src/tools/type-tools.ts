/**
 * Type-related MCP tools
 */

import type { TypeService } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse } from "./types.js";

/**
 * Tool definitions for type operations
 */
export const typeToolDefinitions: ToolDefinition[] = [
  {
    name: "list_types",
    description:
      "List all available issue/task types with their GitHub label mappings. " +
      "Returns array of types with name, description, and githubLabel. " +
      "Use this before generate_plan to know valid type values.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Service context for type handlers
 */
export interface TypeToolContext {
  typeService: TypeService;
}

/**
 * Handle list_types tool call
 *
 * Returns all valid types with their metadata (name, description, githubLabel).
 * This allows Claude to know what types are valid before calling generate_plan.
 */
export async function handleListTypes(ctx: TypeToolContext): Promise<ToolResponse> {
  const types = await ctx.typeService.getTypes();

  return successResponse({
    types: types.map((t) => ({
      name: t.name,
      description: t.description,
      githubLabel: t.githubLabel,
    })),
    message: `${types.length} type(s) available. Use these values for the 'type' field in generate_plan tasks.`,
  });
}

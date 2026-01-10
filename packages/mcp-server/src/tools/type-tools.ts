/**
 * Type-related MCP tools
 *
 * Provides tools for managing issue/task type definitions.
 * Types are stored in the global database and are universal across all projects.
 */

import type { TypeService } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Tool definitions for type operations
 */
export const typeToolDefinitions: ToolDefinition[] = [
  {
    name: "list_types",
    description:
      "List all available issue/task types with their remote label mappings. " +
      "Returns array of types with name, description, and remoteLabel. " +
      "Use this before generate_plan to know valid type values.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_type",
    description:
      "Create a new issue/task type. Types must have unique uppercase names. " +
      "Keywords help Claude select the right type based on issue descriptions. " +
      "Example: create_type('EPIC', 'Epic', 'Large feature spanning multiple issues', ['epic', 'large', 'umbrella'])",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Uppercase type name (e.g., 'EPIC', 'TECH_DEBT'). Must be uppercase letters, numbers, and underscores.",
        },
        displayName: {
          type: "string",
          description: "Human-readable display name (e.g., 'Epic', 'Tech Debt')",
        },
        description: {
          type: "string",
          description: "Description explaining when to use this type",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Keywords for intelligent type selection (optional)",
        },
        color: {
          type: "string",
          description: "Optional UI color (hex string, e.g., '#ff0000')",
        },
      },
      required: ["name", "displayName", "description"],
    },
  },
  {
    name: "update_type",
    description:
      "Update an existing type's displayName, description, keywords, or color. " +
      "Cannot change the type name - delete and recreate instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Type name to update (e.g., 'FEATURE')",
        },
        updates: {
          type: "object",
          properties: {
            displayName: {
              type: "string",
              description: "New display name",
            },
            description: {
              type: "string",
              description: "New description",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "New keywords array",
            },
            color: {
              type: ["string", "null"],
              description: "New color (or null to clear)",
            },
          },
          description: "Fields to update",
        },
      },
      required: ["name", "updates"],
    },
  },
  {
    name: "delete_type",
    description:
      "Soft-delete a type. The type will no longer be available for new issues/tasks, " +
      "but existing records referencing it will be preserved. " +
      "Even default types (FEATURE, BUG, etc.) can be deleted.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Type name to delete (e.g., 'SPIKE')",
        },
      },
      required: ["name"],
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
 * Returns all valid types with their metadata (name, description, remoteLabel).
 * This allows Claude to know what types are valid before calling generate_plan.
 */
export async function handleListTypes(ctx: TypeToolContext): Promise<ToolResponse> {
  const types = await ctx.typeService.getTypes();

  return successResponse({
    types: types.map((t) => ({
      name: t.name,
      description: t.description,
      remoteLabel: t.remoteLabel,
    })),
    message: `${types.length} type(s) available. Use these values for the 'type' field in generate_plan tasks.`,
  });
}

/**
 * Arguments for create_type tool
 */
interface CreateTypeArgs {
  name: string;
  displayName: string;
  description: string;
  keywords?: string[];
  color?: string;
}

/**
 * Handle create_type tool call
 *
 * Creates a new type in the global database.
 */
export function handleCreateType(ctx: TypeToolContext, args: CreateTypeArgs): ToolResponse {
  try {
    const type = ctx.typeService.createType({
      name: args.name,
      displayName: args.displayName,
      description: args.description,
      keywords: args.keywords,
      color: args.color,
    });

    return successResponse({
      type: {
        name: type.name,
        displayName: args.displayName,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' created successfully.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

/**
 * Arguments for update_type tool
 */
interface UpdateTypeArgs {
  name: string;
  updates: {
    displayName?: string;
    description?: string;
    keywords?: string[];
    color?: string | null;
  };
}

/**
 * Handle update_type tool call
 *
 * Updates an existing type's properties.
 */
export function handleUpdateType(ctx: TypeToolContext, args: UpdateTypeArgs): ToolResponse {
  try {
    const type = ctx.typeService.updateType(args.name, args.updates);

    return successResponse({
      type: {
        name: type.name,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' updated successfully.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

/**
 * Arguments for delete_type tool
 */
interface DeleteTypeArgs {
  name: string;
}

/**
 * Handle delete_type tool call
 *
 * Soft-deletes a type. It will no longer be available for new issues/tasks.
 */
export function handleDeleteType(ctx: TypeToolContext, args: DeleteTypeArgs): ToolResponse {
  try {
    const type = ctx.typeService.deleteType(args.name);

    return successResponse({
      type: {
        name: type.name,
        description: type.description,
      },
      message: `Type '${type.name}' deleted successfully. Existing records are preserved.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

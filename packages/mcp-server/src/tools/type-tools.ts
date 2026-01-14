/**
 * Type-related MCP tools
 *
 * Provides tools for managing issue/task type definitions.
 * Types are stored in the global database and are universal across all projects.
 */

import type { TypeService } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse } from "./types.js";
import { createMcpHandler, createNoArgsHandler, validateToolArgs } from "../di/bootstrap.js";
import {
  CreateTypeSchema,
  UpdateTypeSchema,
  DeleteTypeSchema,
  type CreateTypeArgs,
  type UpdateTypeArgs,
  type DeleteTypeArgs,
} from "./schemas.js";

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

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle list_types tool call
 */
async function listTypesHandler({
  typeService,
}: {
  typeService: TypeService;
}): Promise<ToolResponse> {
  const types = await typeService.getTypes();

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
 * Handle create_type tool call
 */
function createTypeHandler(
  args: unknown,
  { typeService }: { typeService: TypeService }
): ToolResponse {
  const validation = validateToolArgs<CreateTypeArgs>(CreateTypeSchema, args);
  if (!validation.success) return validation.response;

  const { name, displayName, description, keywords, color } = validation.data;

  const type = typeService.createType({
    name,
    displayName,
    description,
    keywords,
    color,
  });

  return successResponse({
    type: {
      name: type.name,
      displayName,
      description: type.description,
      keywords: type.keywords,
      remoteLabel: type.remoteLabel,
    },
    message: `Type '${type.name}' created successfully.`,
  });
}

/**
 * Handle update_type tool call
 */
function updateTypeHandler(
  args: unknown,
  { typeService }: { typeService: TypeService }
): ToolResponse {
  const validation = validateToolArgs<UpdateTypeArgs>(UpdateTypeSchema, args);
  if (!validation.success) return validation.response;

  const { name, updates } = validation.data;

  const type = typeService.updateType(name, updates);

  return successResponse({
    type: {
      name: type.name,
      description: type.description,
      keywords: type.keywords,
      remoteLabel: type.remoteLabel,
    },
    message: `Type '${type.name}' updated successfully.`,
  });
}

/**
 * Handle delete_type tool call
 */
function deleteTypeHandler(
  args: unknown,
  { typeService }: { typeService: TypeService }
): ToolResponse {
  const validation = validateToolArgs<DeleteTypeArgs>(DeleteTypeSchema, args);
  if (!validation.success) return validation.response;

  const { name } = validation.data;

  const type = typeService.deleteType(name);

  return successResponse({
    type: {
      name: type.name,
      description: type.description,
    },
    message: `Type '${type.name}' deleted successfully. Existing records are preserved.`,
  });
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleListTypes = createNoArgsHandler(listTypesHandler);
export const handleCreateType = createMcpHandler(createTypeHandler);
export const handleUpdateType = createMcpHandler(updateTypeHandler);
export const handleDeleteType = createMcpHandler(deleteTypeHandler);

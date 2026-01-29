/**
 * Type tool definitions and handlers
 *
 * Pattern:
 * - Tool definitions describe the MCP interface
 * - Handlers are thin wrappers: validate + delegate + return success
 * - createMcpHandler wraps with error handling
 */

import type { ToolDefinition } from "./types.js";
import { successResponse } from "./types.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import { CreateTypeSchema, UpdateTypeSchema, DeleteTypeSchema } from "./schemas.js";
import type { TypeTool } from "./type-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

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
// Handlers
// =============================================================================

export const handleListTypes = createMcpHandler(
  async (_args: unknown, { typeTool }: { typeTool: TypeTool }) => {
    return successResponse(await typeTool.listTypes());
  }
);

export const handleCreateType = createMcpHandler(
  (args: unknown, { typeTool }: { typeTool: TypeTool }) => {
    const validated = validateSchema(CreateTypeSchema, args);
    return successResponse(typeTool.createType(validated));
  }
);

export const handleUpdateType = createMcpHandler(
  (args: unknown, { typeTool }: { typeTool: TypeTool }) => {
    const validated = validateSchema(UpdateTypeSchema, args);
    return successResponse(typeTool.updateType(validated));
  }
);

export const handleDeleteType = createMcpHandler(
  (args: unknown, { typeTool }: { typeTool: TypeTool }) => {
    const validated = validateSchema(DeleteTypeSchema, args);
    return successResponse(typeTool.deleteType(validated));
  }
);

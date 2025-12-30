/**
 * Shared types for MCP tools
 */

/**
 * MCP tool response content
 */
export interface ToolContent {
  type: "text";
  text: string;
}

/**
 * MCP tool response - compatible with MCP SDK CallToolResult
 */
export interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * Args type - what the MCP SDK passes to tool handlers
 */
export type ToolArgs = Record<string, unknown> | undefined;

/**
 * MCP tool definition schema
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Create a successful JSON response
 */
export function successResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create an error JSON response
 */
export function errorResponse(error: string): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: false, error }, null, 2),
      },
    ],
  };
}

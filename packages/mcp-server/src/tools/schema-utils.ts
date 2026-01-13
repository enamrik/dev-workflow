/**
 * Utilities for converting Zod schemas to JSON Schema for MCP tool definitions
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "./types.js";

/**
 * Convert a Zod schema to JSON Schema format for MCP tool definitions.
 *
 * This removes the $schema property and extracts the required fields.
 */
export function zodToInputSchema(schema: z.ZodTypeAny): ToolDefinition["inputSchema"] {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });

  // Type assertion to access properties
  const schemaObj = jsonSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    $schema?: string;
  };

  // Remove $schema as MCP doesn't need it
  delete schemaObj.$schema;

  // Ensure type is "object"
  if (schemaObj.type !== "object") {
    throw new Error("Tool input schema must be an object type");
  }

  return {
    type: "object",
    properties: schemaObj.properties ?? {},
    ...(schemaObj.required && schemaObj.required.length > 0
      ? { required: schemaObj.required }
      : {}),
  };
}

/**
 * Create a tool definition from a Zod schema.
 *
 * This is a convenience function that combines the name, description,
 * and Zod schema into a complete tool definition.
 */
export function createToolDefinition(
  name: string,
  description: string,
  schema: z.ZodTypeAny
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: zodToInputSchema(schema),
  };
}

/**
 * Validate tool arguments against a Zod schema.
 *
 * Returns the validated and typed arguments, or throws a ZodError.
 */
export function validateArgs<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  return schema.parse(args);
}

/**
 * Safely validate tool arguments against a Zod schema.
 *
 * Returns a result object with either the validated data or an error message.
 */
export function safeValidateArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(args);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors into a readable message
  const errors = result.error.errors.map((err: { path: (string | number)[]; message: string }) => {
    const path = err.path.join(".");
    return path ? `${path}: ${err.message}` : err.message;
  });

  return { success: false, error: errors.join("; ") };
}

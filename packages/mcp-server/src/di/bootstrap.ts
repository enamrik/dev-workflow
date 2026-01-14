/**
 * MCP Handler Bootstrap
 *
 * Provides utilities for creating MCP tool handlers with:
 * - Middleware composition (using core's compose pattern)
 * - Dependency injection from Awilix cradle
 * - Consistent error handling
 *
 * Design:
 * - Tool classes encapsulate business logic with constructor DI
 * - Handlers are thin wrappers: validate + delegate to tool
 * - createMcpHandler wraps with error handling: (args, cradle) => response
 * - createMcpTool binds to container: (args) => response
 */

import type { ZodSchema } from "zod";
import type { AwilixContainer } from "awilix";
import { compose, type Middleware } from "@dev-workflow/core/infrastructure/di";
import type { McpCradle } from "./container.js";
import { type ToolResponse, errorResponse } from "../tools/types.js";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * A handler function that receives args and cradle.
 * Handler destructures what it needs from cradle (typically just the tool class).
 */
export type McpHandler<TCradle extends object = McpCradle> = (
  args: unknown,
  cradle: TCradle
) => ToolResponse | Promise<ToolResponse>;

/**
 * A wrapped handler with error handling.
 * Signature: (args, cradle) => Promise<ToolResponse>
 */
export type WrappedMcpHandler<TCradle extends object = McpCradle> = (
  args: unknown,
  cradle: TCradle
) => Promise<ToolResponse>;

/**
 * A bound tool ready for invocation.
 * Signature: (args) => Promise<ToolResponse>
 */
export type McpTool = (args: unknown) => Promise<ToolResponse>;

/**
 * MCP-specific middleware type.
 * Middleware receives (args, cradle) and can:
 * - Return void to continue the chain
 * - Return ToolResponse to short-circuit
 * - Throw an error (caught by error handler)
 */
export type McpMiddleware<TCradle extends object = McpCradle> = Middleware<
  unknown,
  TCradle,
  ToolResponse
>;

// =============================================================================
// Validation Helper
// =============================================================================

/**
 * Validates tool arguments against a Zod schema.
 * Throws an error if validation fails (caught by createMcpHandler).
 *
 * @example
 * ```typescript
 * function dispatchTaskHandler(args: unknown, { dispatchTool }: Deps) {
 *   const validated = validateSchema(DispatchTaskSchema, args);
 *   return successResponse(dispatchTool.dispatch(validated));
 * }
 * ```
 */
export function validateSchema<T>(schema: ZodSchema<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const errorMessage = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    throw new Error(`Invalid arguments: ${errorMessage}`);
  }
  return result.data;
}

/**
 * Legacy validation helper.
 * Returns { success: true, data } or { success: false, response: errorResponse() }
 *
 * @deprecated Use validateSchema() instead which throws on failure.
 * This is kept for backward compatibility during migration.
 */
export function validateToolArgs<T>(
  schema: ZodSchema<T>,
  args: unknown
): { success: true; data: T } | { success: false; response: ToolResponse } {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const errorMessage = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    return { success: false, response: errorResponse(`Invalid arguments: ${errorMessage}`) };
  }
  return { success: true, data: result.data };
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Wraps a handler with middleware and error handling.
 * Returns: (args, cradle) => Promise<ToolResponse>
 *
 * @example
 * ```typescript
 * // Raw handler - validates and delegates to tool
 * function dispatchTaskHandler(args: unknown, { dispatchTool }: Deps) {
 *   const validated = validateSchema(DispatchTaskSchema, args);
 *   return successResponse(dispatchTool.dispatch(validated));
 * }
 *
 * // Wrapped handler with error handling
 * export const dispatchTaskHandler = createMcpHandler(rawHandler);
 * ```
 */
export function createMcpHandler<TCradle extends object = McpCradle>(
  handler: McpHandler<TCradle>,
  middleware?: McpMiddleware<TCradle>
): WrappedMcpHandler<TCradle> {
  return async (args: unknown, cradle: TCradle): Promise<ToolResponse> => {
    try {
      // Run middleware chain first
      if (middleware) {
        const earlyReturn = await middleware(args, cradle);
        if (earlyReturn !== undefined) {
          return earlyReturn;
        }
      }

      // Execute handler
      return await handler(args, cradle);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// =============================================================================
// Tool Binding
// =============================================================================

/**
 * Binds a wrapped handler to a container's cradle.
 * Returns: (args) => Promise<ToolResponse>
 *
 * @example
 * ```typescript
 * // Production: bind to production container
 * const tools = {
 *   dispatch_task: createMcpTool(dispatchTaskHandler, prodContainer),
 * };
 *
 * // Tests: bind to test container with mocked deps
 * const tool = createMcpTool(dispatchTaskHandler, testContainer);
 * const result = await tool({ taskId: "..." });
 * ```
 */
export function createMcpTool<TCradle extends object = McpCradle>(
  handler: WrappedMcpHandler<TCradle>,
  container: AwilixContainer<TCradle>
): McpTool {
  return (args: unknown) => handler(args, container.cradle);
}

// =============================================================================
// No-Args Handler Helper
// =============================================================================

/**
 * Creates a handler for tools that take no arguments.
 * This is a convenience wrapper that ignores the args parameter.
 *
 * @example
 * ```typescript
 * export const handleGetProjectStats = createNoArgsHandler(
 *   ({ issueTool }: { issueTool: IssueTool }) => {
 *     return successResponse(issueTool.getProjectStats());
 *   }
 * );
 * ```
 */
export function createNoArgsHandler<TCradle extends object = McpCradle>(
  handler: (cradle: TCradle) => ToolResponse | Promise<ToolResponse>
): WrappedMcpHandler<TCradle> {
  return createMcpHandler((_args: unknown, cradle: TCradle) => handler(cradle));
}

// =============================================================================
// Re-export compose for middleware building
// =============================================================================

export { compose };

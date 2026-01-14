/**
 * MCP Handler Bootstrap
 *
 * Provides utilities for creating MCP tool handlers with:
 * - Middleware composition (using core's compose pattern)
 * - Dependency injection from Awilix cradle
 * - Consistent error handling
 * - Easy testing via container override
 *
 * Design:
 * - Handlers are pure functions: (args, cradle) => ToolResponse
 * - Handler destructures what it needs from cradle
 * - Middleware can validate, short-circuit, or pass through
 * - Container is optional, defaults to production
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
 * A pure handler function that receives args and the full cradle.
 * Handler destructures what it needs from cradle.
 * Handlers should validate args internally using validateToolArgs.
 */
export type McpHandler<TCradle extends object = McpCradle> = (
  args: unknown,
  cradle: TCradle
) => ToolResponse | Promise<ToolResponse>;

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

/**
 * A container-like object that provides a cradle.
 * Can be a full AwilixContainer or a simple { cradle: T } for testing.
 */
export type ContainerLike<TCradle extends object> = AwilixContainer<TCradle> | { cradle: TCradle };

/**
 * The final handler function signature.
 * Accepts either a full AwilixContainer or a simple { cradle: T } for testing.
 */
export type McpToolHandler<TCradle extends object = McpCradle> = (
  args: unknown,
  container?: ContainerLike<TCradle>
) => Promise<ToolResponse>;

// =============================================================================
// Validation Helper
// =============================================================================

/**
 * Validation result type for type-safe handling.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: ToolResponse };

/**
 * Validates tool arguments against a Zod schema.
 *
 * Use this inside handlers for explicit, type-safe validation:
 *
 * @example
 * ```typescript
 * function createIssueHandler(args: unknown, deps: Deps): Promise<ToolResponse> {
 *   const validation = validateToolArgs(createIssueSchema, args);
 *   if (!validation.success) return validation.response;
 *
 *   // validation.data is typed as CreateIssueArgs
 *   const issue = await deps.issueService.create(validation.data);
 *   return successResponse({ issue });
 * }
 * ```
 */
export function validateToolArgs<T>(schema: ZodSchema<T>, args: unknown): ValidationResult<T> {
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
 * Module-level container reference.
 * Set by initializeContainer() during server startup.
 */
let defaultContainer: AwilixContainer<McpCradle> | null = null;

/**
 * Initialize the default container for production use.
 * Called once during server startup.
 */
export function initializeContainer(container: AwilixContainer<McpCradle>): void {
  defaultContainer = container;
}

/**
 * Get the default container. Throws if not initialized.
 */
export function getContainer(): AwilixContainer<McpCradle> {
  if (!defaultContainer) {
    throw new Error("Container not initialized. Call initializeContainer() first.");
  }
  return defaultContainer;
}

/**
 * Creates an MCP tool handler with middleware and DI injection.
 *
 * Features:
 * - Runs middleware chain before handler (can short-circuit)
 * - Passes full cradle to handler (handler destructures what it needs)
 * - Catches errors and returns errorResponse
 * - Container is optional (uses default) for easy testing
 *
 * @example
 * ```typescript
 * // Define handler as a pure function - destructure what you need
 * async function createIssueHandler(
 *   args: unknown,
 *   { issueService, templateService }: Pick<McpCradle, 'issueService' | 'templateService'>
 * ): Promise<ToolResponse> {
 *   const validation = validateToolArgs(createIssueSchema, args);
 *   if (!validation.success) return validation.response;
 *
 *   const issue = await issueService.create(validation.data);
 *   return successResponse({ issue });
 * }
 *
 * // Create the MCP handler - just handler and optional middleware
 * const handleCreateIssue = createMcpHandler(createIssueHandler, standardMiddleware);
 *
 * // Production usage (uses default container)
 * await handleCreateIssue(args);
 *
 * // Testing with mock container
 * await handleCreateIssue(args, testContainer);
 * ```
 *
 * @param handler - Pure function: (args, cradle) => ToolResponse
 * @param middleware - Optional middleware chain (use compose() to build)
 * @returns Handler function that accepts args and optional container override
 */
export function createMcpHandler<TCradle extends object = McpCradle>(
  handler: McpHandler<TCradle>,
  middleware?: McpMiddleware<TCradle>
): McpToolHandler<TCradle> {
  return async (args: unknown, container?: ContainerLike<TCradle>): Promise<ToolResponse> => {
    // Use provided container or fall back to default
    const resolvedContainer = container ?? (getContainer() as ContainerLike<TCradle>);

    try {
      // Run middleware chain first
      if (middleware) {
        const earlyReturn = await middleware(args, resolvedContainer.cradle);
        if (earlyReturn !== undefined) {
          return earlyReturn;
        }
      }

      // Execute handler with full cradle
      return await handler(args, resolvedContainer.cradle);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

// =============================================================================
// Convenience Helpers
// =============================================================================

/**
 * Creates a handler for tools that need no arguments.
 * Handler receives cradle and destructures what it needs.
 *
 * @example
 * ```typescript
 * const handleGetStats = createNoArgsHandler(
 *   async ({ issueService }) => {
 *     const stats = await issueService.getStats();
 *     return successResponse({ stats });
 *   }
 * );
 * ```
 */
export function createNoArgsHandler<TCradle extends object = McpCradle>(
  handler: (cradle: TCradle) => ToolResponse | Promise<ToolResponse>,
  middleware?: McpMiddleware<TCradle>
): McpToolHandler<TCradle> {
  return createMcpHandler((_args, cradle) => handler(cradle), middleware);
}

// =============================================================================
// Re-export compose for middleware building
// =============================================================================

export { compose };

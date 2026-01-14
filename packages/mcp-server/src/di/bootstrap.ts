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
 * - Handlers are pure functions: (args, deps) => ToolResponse
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
 * A pure handler function that receives args and selected dependencies.
 * Handlers should validate args internally using validateToolArgs.
 */
export type McpHandler<TDeps> = (
  args: unknown,
  deps: TDeps
) => ToolResponse | Promise<ToolResponse>;

/**
 * Selects specific dependencies from the cradle for a handler.
 * Keep selections minimal - only what the handler actually needs.
 */
export type DepsSelector<TDeps, TCradle = McpCradle> = (cradle: TCradle) => TDeps;

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
 * The final handler function signature.
 */
export type McpToolHandler<TCradle extends object = McpCradle> = (
  args: unknown,
  container?: AwilixContainer<TCradle>
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
 * - Injects selected dependencies from cradle
 * - Catches errors and returns errorResponse
 * - Container is optional (uses default) for easy testing
 *
 * @example
 * ```typescript
 * // Define handler as a pure function
 * async function createIssueHandler(
 *   args: unknown,
 *   { issueService, templateService }: CreateIssueDeps
 * ): Promise<ToolResponse> {
 *   const validation = validateToolArgs(createIssueSchema, args);
 *   if (!validation.success) return validation.response;
 *
 *   const issue = await issueService.create(validation.data);
 *   return successResponse({ issue });
 * }
 *
 * // Create the MCP handler
 * const handleCreateIssue = createMcpHandler(
 *   createIssueHandler,
 *   (cradle) => ({
 *     issueService: cradle.issueService,
 *     templateService: cradle.templateService,
 *   }),
 *   standardMiddleware
 * );
 *
 * // Production usage
 * await handleCreateIssue(args);
 *
 * // Testing with mock container
 * await handleCreateIssue(args, testContainer);
 * ```
 *
 * @param handler - Pure function: (args, deps) => ToolResponse
 * @param selectDeps - Function to select deps from cradle
 * @param middleware - Optional middleware chain (use compose() to build)
 * @returns Handler function that accepts args and optional container override
 */
export function createMcpHandler<TDeps, TCradle extends object = McpCradle>(
  handler: McpHandler<TDeps>,
  selectDeps: DepsSelector<TDeps, TCradle>,
  middleware?: McpMiddleware<TCradle>
): McpToolHandler<TCradle> {
  return async (args: unknown, container?: AwilixContainer<TCradle>): Promise<ToolResponse> => {
    // Use provided container or fall back to default
    const resolvedContainer = container ?? (getContainer() as AwilixContainer<TCradle>);

    try {
      // Run middleware chain first
      if (middleware) {
        const earlyReturn = await middleware(args, resolvedContainer.cradle);
        if (earlyReturn !== undefined) {
          return earlyReturn;
        }
      }

      // Select deps and execute handler
      const deps = selectDeps(resolvedContainer.cradle);
      return await handler(args, deps);
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
 *
 * @example
 * ```typescript
 * const handleGetStats = createNoArgsHandler(
 *   async ({ issueService }) => {
 *     const stats = await issueService.getStats();
 *     return successResponse({ stats });
 *   },
 *   (cradle) => ({ issueService: cradle.issueService })
 * );
 * ```
 */
export function createNoArgsHandler<TDeps, TCradle extends object = McpCradle>(
  handler: (deps: TDeps) => ToolResponse | Promise<ToolResponse>,
  selectDeps: DepsSelector<TDeps, TCradle>,
  middleware?: McpMiddleware<TCradle>
): McpToolHandler<TCradle> {
  return createMcpHandler((_args, deps) => handler(deps), selectDeps, middleware);
}

/**
 * Creates a handler that uses the full cradle (all dependencies).
 *
 * Prefer explicit dependency selection for better testability.
 * Use this only when a handler genuinely needs many dependencies.
 *
 * @example
 * ```typescript
 * const handleComplexOperation = createFullCradleHandler(
 *   async (args, cradle) => {
 *     // Access all services via cradle
 *     const issue = await cradle.issueService.create(...);
 *     await cradle.taskSyncService.sync(...);
 *     return successResponse({ issue });
 *   },
 *   standardMiddleware
 * );
 * ```
 */
export function createFullCradleHandler<TCradle extends object = McpCradle>(
  handler: McpHandler<TCradle>,
  middleware?: McpMiddleware<TCradle>
): McpToolHandler<TCradle> {
  return createMcpHandler(handler, (cradle) => cradle, middleware);
}

// =============================================================================
// Re-export compose for middleware building
// =============================================================================

export { compose };

/**
 * MCP Server Bootstrap Functions
 *
 * Provides createTool and createToolHandler for wrapping MCP tool handlers
 * with Awilix dependency injection and error handling.
 *
 * Key pattern:
 * - Tool handlers contain the complete business logic, only dependencies are missing
 * - createTool() wraps handlers with validation and error handling
 * - createToolHandler() provides DI injection from the Awilix cradle
 */

import type { AwilixContainer } from "awilix";
import type { ZodSchema } from "zod";
import type { McpCradle } from "./container.js";
import { type ToolResponse, errorResponse } from "../tools/types.js";

/**
 * Type for a raw tool handler function.
 * Takes validated args and dependencies, returns a tool response.
 *
 * The handler contains complete business logic - only the deps are injected.
 */
export type ToolHandler<TArgs, TDeps> = (
  args: TArgs,
  deps: TDeps
) => ToolResponse | Promise<ToolResponse>;

/**
 * Type for a dependency selector function.
 * Extracts required dependencies from the cradle.
 * TCradle defaults to McpCradle for production use.
 */
export type DepsSelector<TDeps, TCradle = McpCradle> = (cradle: TCradle) => TDeps;

/**
 * Type for a wrapped tool that handles validation and error catching.
 */
export type WrappedTool<TArgs> = (args: TArgs) => Promise<ToolResponse>;

/**
 * Type for the final handler that includes DI injection.
 */
export type DIToolHandler = (args: unknown) => Promise<ToolResponse>;

/**
 * Options for createTool
 */
export interface CreateToolOptions<TArgs> {
  /** Zod schema for argument validation */
  schema: ZodSchema<TArgs>;
}

/**
 * Create a tool wrapper that handles validation and error catching.
 *
 * This wraps a handler with:
 * 1. Zod schema validation for arguments
 * 2. Try-catch error handling with errorResponse conversion
 *
 * @example
 * ```typescript
 * const tool = createTool(
 *   { schema: createIssueSchema },
 *   async (args, deps) => {
 *     const issue = deps.issueService.create({ title: args.title });
 *     return successResponse({ issue });
 *   }
 * );
 * ```
 */
export function createTool<TArgs, TDeps>(
  options: CreateToolOptions<TArgs>,
  handler: ToolHandler<TArgs, TDeps>
): (deps: TDeps) => WrappedTool<unknown> {
  const { schema } = options;

  return (deps: TDeps) => {
    return async (rawArgs: unknown): Promise<ToolResponse> => {
      // Validate arguments
      const parseResult = schema.safeParse(rawArgs ?? {});
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        return errorResponse(`Invalid arguments: ${errorMessage}`);
      }

      // Execute handler with error catching
      try {
        return await handler(parseResult.data, deps);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    };
  };
}

/**
 * Create a DI-injected tool handler that can be registered with the MCP server.
 *
 * This combines a tool with a dependency selector to produce a handler
 * that pulls deps from the Awilix container and executes the tool.
 *
 * The TCradle type parameter allows testing with custom cradle types.
 *
 * @example
 * ```typescript
 * // Create the tool
 * const createIssueTool = createTool(
 *   { schema: createIssueSchema },
 *   async (args, deps) => {
 *     const issue = deps.issueService.create({ title: args.title });
 *     return successResponse({ issue });
 *   }
 * );
 *
 * // Create the handler with DI
 * export const handleCreateIssue = createToolHandler(
 *   createIssueTool,
 *   (cradle) => ({
 *     issueService: cradle.issueService,
 *     templateService: cradle.templateService,
 *   }),
 *   container
 * );
 * ```
 *
 * @param toolFactory - Function returned by createTool that takes deps and returns a wrapped tool
 * @param depsSelector - Function that extracts required deps from the cradle
 * @param container - The Awilix container (usually the global mcpContainer)
 */
export function createToolHandler<TDeps, TCradle extends object = McpCradle>(
  toolFactory: (deps: TDeps) => WrappedTool<unknown>,
  depsSelector: DepsSelector<TDeps, TCradle>,
  container: AwilixContainer<TCradle>
): DIToolHandler {
  return async (args: unknown): Promise<ToolResponse> => {
    const deps = depsSelector(container.cradle);
    const tool = toolFactory(deps);
    return tool(args);
  };
}

/**
 * Simplified helper for tools that need the full cradle.
 *
 * For tools that need many dependencies, this avoids listing them all
 * in the selector. Use sparingly - explicit dep selection is preferred.
 *
 * @example
 * ```typescript
 * export const handleComplexTool = createFullCradleHandler(
 *   createTool(
 *     { schema: complexSchema },
 *     async (args, cradle) => {
 *       // Access all services via cradle
 *       const issue = cradle.issueService.create(...);
 *       return successResponse({ issue });
 *     }
 *   ),
 *   container
 * );
 * ```
 */
export function createFullCradleHandler(
  toolFactory: (deps: McpCradle) => WrappedTool<unknown>,
  container: AwilixContainer<McpCradle>
): DIToolHandler {
  return createToolHandler(toolFactory, (cradle) => cradle, container);
}

/**
 * Type for tools that take no arguments (empty object).
 */
export type NoArgsToolHandler<TDeps> = (deps: TDeps) => ToolResponse | Promise<ToolResponse>;

/**
 * Create a tool handler for tools with no arguments.
 *
 * The TCradle type parameter allows testing with custom cradle types.
 *
 * @example
 * ```typescript
 * export const handleGetProjectStats = createNoArgsToolHandler(
 *   async (deps) => {
 *     const stats = deps.issueService.getStatusCounts();
 *     return successResponse({ stats });
 *   },
 *   (cradle) => ({ issueService: cradle.issueService }),
 *   container
 * );
 * ```
 */
export function createNoArgsToolHandler<TDeps, TCradle extends object = McpCradle>(
  handler: NoArgsToolHandler<TDeps>,
  depsSelector: DepsSelector<TDeps, TCradle>,
  container: AwilixContainer<TCradle>
): DIToolHandler {
  return async (_args: unknown): Promise<ToolResponse> => {
    const deps = depsSelector(container.cradle);
    try {
      return await handler(deps);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

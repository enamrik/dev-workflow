/**
 * MCP Handler Bootstrap
 *
 * Provides utilities for creating MCP tool handlers with:
 * - Effect-based program creation (createMcpHandler)
 * - Tool binding to containers (createMcpTool)
 *
 * Design:
 * - createMcpHandler: program creator — catches E channel errors, returns McpProgram struct
 * - createMcpTool(program, container): runner — binds program to container, produces McpTool
 */

import type { AwilixContainer } from "awilix";
import { Effect, createRuntime } from "@dev-workflow/effect";
import { type ToolResponse, errorResponse } from "../tools/types.js";

/**
 * Version-agnostic schema interface. Works with both Zod 3 and Zod 4.
 * The only method we need is `parse` — everything else is Zod-internal.
 */
interface ParseableSchema<T> {
  parse(input: unknown): T;
}

/**
 * Container middleware for registering dynamic values before handler runs.
 */
export type ContainerMiddleware = (container: AwilixContainer) => Promise<void> | void;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Program struct returned by createMcpHandler.
 * Contains the Effect function and optional middleware.
 */
export interface McpProgram<R> {
  readonly run: (args: unknown) => Effect<ToolResponse, never, R>;
  readonly middleware?: ContainerMiddleware;
}

/**
 * A bound tool ready for invocation.
 * Signature: (args) => Promise<ToolResponse>
 */
export type McpTool = (args: unknown) => Promise<ToolResponse>;

// =============================================================================
// Effect Program Creator
// =============================================================================

/**
 * Creates an MCP handler program that catches all errors from the E channel.
 * Returns a McpProgram struct with run function and optional middleware.
 *
 * Validates args at the boundary using the provided schema and provides typed args to handler.
 *
 * Domain owns the schema. The MCP medium derives its args schema from the domain:
 * ```typescript
 * // Domain schema (source of truth)
 * const CloseIssueSchema = z.object({ projectSlug, issueNumber, force, closedBy });
 *
 * // MCP args schema (derived — projectSlug comes from DI context)
 * const ArgsSchema = CloseIssueSchema.omit({ projectSlug: true });
 *
 * export const handleCloseIssue = createMcpHandler({
 *   schema: ArgsSchema,
 *   handler: (args) =>
 *     Effect.gen(function* () {
 *       const projectSlug = yield* ProjectSlug;
 *       return successResponse(yield* closeIssue({ ...args, projectSlug }));
 *     }),
 * });
 * ```
 */
export function createMcpHandler<T, E, R>({
  schema,
  handler,
  middleware,
}: {
  schema: ParseableSchema<T>;
  handler: (args: T) => Effect<ToolResponse, E, R>;
  middleware?: ContainerMiddleware;
}): McpProgram<R> {
  return {
    run: (args: unknown) =>
      Effect.catchAll(
        Effect.gen(function* () {
          const validated = schema.parse(args);
          return yield* handler(validated);
        }),
        (error: unknown) =>
          Effect.succeed(errorResponse(error instanceof Error ? error.message : String(error)))
      ),
    middleware,
  };
}

// =============================================================================
// Tool Binding (Runner)
// =============================================================================

/**
 * Binds a handler program to a container, producing a ready-to-call McpTool.
 * Executes middleware (if any) before each invocation, then runs the Effect.
 *
 * @example
 * ```typescript
 * const tool = createMcpTool(handleCloseIssue, container);
 * const result = await tool({ issueNumber: 1 });
 * ```
 */
export function createMcpTool<R>(program: McpProgram<R>, container: AwilixContainer): McpTool {
  const runtime = createRuntime(container);
  return async (args: unknown) => {
    try {
      if (program.middleware) await program.middleware(container);
      return await runtime.runEffectAndUnwrap(program.run(args));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  };
}

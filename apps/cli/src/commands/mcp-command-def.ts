/**
 * MCP Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with MCPCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { MCPCommandTag } from "../di/cli-tags.js";

/**
 * Options for MCP command (currently no options)
 */
export type MCPOptions = Record<string, never>;

/**
 * Handler for mcp command.
 */
export const handleMCP = createCliHandler({
  handler: (_options: MCPOptions) =>
    Effect.gen(function* () {
      const mcpCommand = yield* MCPCommandTag;
      mcpCommand.execute();
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runner.
 */
export const runMCP = createCliCommand(handleMCP);

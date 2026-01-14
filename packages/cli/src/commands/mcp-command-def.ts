/**
 * MCP Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with MCPCommand class for testability.
 */

import { createCliHandler, createCliRunner, defaultMiddleware } from "../di/bootstrap.js";
import type { MCPCommand } from "./mcp-command.js";

/**
 * Options for MCP command (currently no options)
 */
export type MCPOptions = Record<string, never>;

/**
 * Handler for mcp command.
 */
export const handleMCP = createCliHandler(
  (_options: MCPOptions, { mcpCommand }: { mcpCommand: MCPCommand }) => {
    mcpCommand.execute();
  },
  defaultMiddleware
);

/**
 * Executable runner.
 */
export const runMCP = createCliRunner(handleMCP);

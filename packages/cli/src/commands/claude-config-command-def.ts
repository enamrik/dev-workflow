/**
 * Claude Config Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with ClaudeConfigCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import type { ClaudeConfigCommand, CleanOptions } from "./claude-config-command.js";

/**
 * Handler for clean-claude-config command.
 */
export const handleCleanClaudeConfig = createCliHandler(
  async (
    options: CleanOptions,
    { claudeConfigCommand }: { claudeConfigCommand: ClaudeConfigCommand }
  ) => {
    await claudeConfigCommand.clean(options);
  },
  defaultMiddleware
);

/**
 * Executable runner.
 */
export const runCleanClaudeConfig = createCliCommand(handleCleanClaudeConfig);

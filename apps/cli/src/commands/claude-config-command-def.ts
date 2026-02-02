/**
 * Claude Config Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with ClaudeConfigCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { ClaudeConfigCommandTag } from "../di/cli-tags.js";
import type { CleanOptions } from "./claude-config-command.js";

/**
 * Handler for clean-claude-config command.
 */
export const handleCleanClaudeConfig = createCliHandler({
  handler: (options: CleanOptions) =>
    Effect.gen(function* () {
      const claudeConfigCommand = yield* ClaudeConfigCommandTag;
      yield* Effect.promise(() => claudeConfigCommand.clean(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runner.
 */
export const runCleanClaudeConfig = createCliCommand(handleCleanClaudeConfig);

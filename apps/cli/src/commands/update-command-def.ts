/**
 * Update Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UpdateCommand class for testability.
 */

import { createCliHandler, createCliCommand, withConfigMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UpdateCommandTag } from "../di/cli-tags.js";

/**
 * Options for the update command.
 */
export interface UpdateOptions {
  /** Install a specific release version instead of the latest. */
  version?: string;
  /** List recent releases and exit. */
  list?: boolean;
}

/**
 * Handler - thin wrapper that yields the command from Effect context.
 */
export const handleUpdate = createCliHandler({
  handler: (options: UpdateOptions) =>
    Effect.gen(function* () {
      const updateCommand = yield* UpdateCommandTag;
      yield* Effect.promise(() => updateCommand.execute(options));
    }),
  middleware: withConfigMiddleware,
});

/**
 * Executable runner for the update command.
 */
export const runUpdate = createCliCommand(handleUpdate);

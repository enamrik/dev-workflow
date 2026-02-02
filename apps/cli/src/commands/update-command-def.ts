/**
 * Update Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UpdateCommand class for testability.
 */

import { createCliHandler, createCliCommand, withConfigMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UpdateCommandTag } from "../di/cli-tags.js";

/**
 * Options for the update command (currently no options)
 */
export type UpdateOptions = Record<string, never>;

/**
 * Handler - thin wrapper that yields the command from Effect context.
 */
export const handleUpdate = createCliHandler({
  handler: (_options: UpdateOptions) =>
    Effect.gen(function* () {
      const updateCommand = yield* UpdateCommandTag;
      yield* Effect.promise(() => updateCommand.execute());
    }),
  middleware: withConfigMiddleware,
});

/**
 * Executable runner for the update command.
 */
export const runUpdate = createCliCommand(handleUpdate);

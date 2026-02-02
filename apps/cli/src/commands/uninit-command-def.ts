/**
 * Uninit Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UninitCommand class for testability.
 */

import { createCliHandler, createCliCommand, withConfigMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UninitCommandTag } from "../di/cli-tags.js";

/**
 * Options for the uninit command (currently no options)
 */
export type UninitOptions = Record<string, never>;

/**
 * Handler - thin wrapper that yields the command from Effect context.
 */
export const handleUninit = createCliHandler({
  handler: (_options: UninitOptions) =>
    Effect.gen(function* () {
      const uninitCommand = yield* UninitCommandTag;
      yield* Effect.promise(() => uninitCommand.execute());
    }),
  middleware: withConfigMiddleware,
});

/**
 * Executable runner for the uninit command.
 */
export const runUninit = createCliCommand(handleUninit);

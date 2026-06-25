/**
 * Setup Command Handler and Runner
 *
 * Uses the Awilix DI pattern with SetupCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { SetupCommandTag } from "../di/cli-tags.js";
import type { SetupOptions } from "./setup-command.js";

/**
 * Handler - thin wrapper that yields the command from Effect context.
 */
export const handleSetup = createCliHandler({
  handler: (options: SetupOptions) =>
    Effect.gen(function* () {
      const setupCommand = yield* SetupCommandTag;
      yield* Effect.promise(() => setupCommand.execute(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runner for the setup command.
 */
export const runSetup = createCliCommand(handleSetup);

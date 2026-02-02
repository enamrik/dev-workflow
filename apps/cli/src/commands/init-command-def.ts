/**
 * Init Command Handler and Runner
 *
 * Uses the Awilix DI pattern with InitCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { InitCommandTag } from "../di/cli-tags.js";
import type { InitOptions } from "./init-command.js";

/**
 * Handler - thin wrapper that yields the command from Effect context.
 */
export const handleInit = createCliHandler({
  handler: (options: InitOptions) =>
    Effect.gen(function* () {
      const initCommand = yield* InitCommandTag;
      yield* Effect.promise(() => initCommand.execute(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runner for the init command.
 */
export const runInit = createCliCommand(handleInit);

/**
 * Database Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with DatabaseCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { DatabaseCommandTag } from "../di/cli-tags.js";
import type { ConfigureOptions } from "./database-command.js";

/**
 * Options for database status command (currently no options)
 */
export type DatabaseStatusOptions = Record<string, never>;

/**
 * Handler for database configure command.
 */
export const handleDatabaseConfigure = createCliHandler({
  handler: (options: ConfigureOptions) =>
    Effect.gen(function* () {
      const databaseCommand = yield* DatabaseCommandTag;
      yield* Effect.promise(() => databaseCommand.configure(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for database status command.
 */
export const handleDatabaseStatus = createCliHandler({
  handler: (_options: DatabaseStatusOptions) =>
    Effect.gen(function* () {
      const databaseCommand = yield* DatabaseCommandTag;
      yield* Effect.promise(() => databaseCommand.status());
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runners.
 */
export const runDatabaseConfigure = createCliCommand(handleDatabaseConfigure);
export const runDatabaseStatus = createCliCommand(handleDatabaseStatus);

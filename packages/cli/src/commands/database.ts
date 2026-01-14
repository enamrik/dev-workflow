/**
 * Database Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with DatabaseCommand class for testability.
 */

import { createCliHandler, createCliRunner, defaultMiddleware } from "../di/bootstrap.js";
import type { DatabaseCommand, ConfigureOptions } from "./database-command.js";

/**
 * Options for database status command (currently no options)
 */
export type DatabaseStatusOptions = Record<string, never>;

/**
 * Handler for database configure command.
 */
export const handleDatabaseConfigure = createCliHandler(
  async (options: ConfigureOptions, { databaseCommand }: { databaseCommand: DatabaseCommand }) => {
    await databaseCommand.configure(options);
  },
  defaultMiddleware
);

/**
 * Handler for database status command.
 */
export const handleDatabaseStatus = createCliHandler(
  async (
    _options: DatabaseStatusOptions,
    { databaseCommand }: { databaseCommand: DatabaseCommand }
  ) => {
    await databaseCommand.status();
  },
  defaultMiddleware
);

/**
 * Executable runners.
 */
export const runDatabaseConfigure = createCliRunner(handleDatabaseConfigure);
export const runDatabaseStatus = createCliRunner(handleDatabaseStatus);

/**
 * Update Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UpdateCommand class for testability.
 */

import { createCliHandler, createCliRunner, withConfigMiddleware } from "../di/bootstrap.js";
import type { UpdateCommand } from "./update-command.js";

/**
 * Options for the update command (currently no options)
 */
export type UpdateOptions = Record<string, never>;

/**
 * Handler - thin wrapper that destructures just what it needs (the command).
 */
export const handleUpdate = createCliHandler(
  async (_options: UpdateOptions, { updateCommand }: { updateCommand: UpdateCommand }) => {
    await updateCommand.execute();
  },
  withConfigMiddleware
);

/**
 * Executable runner for the update command.
 */
export const runUpdate = createCliRunner(handleUpdate);

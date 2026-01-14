/**
 * Uninit Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UninitCommand class for testability.
 */

import { createCliHandler, createCliRunner, withConfigMiddleware } from "../di/bootstrap.js";
import type { UninitCommand } from "./uninit-command.js";

/**
 * Options for the uninit command (currently no options)
 */
export type UninitOptions = Record<string, never>;

/**
 * Handler - thin wrapper that destructures just what it needs (the command).
 */
export const handleUninit = createCliHandler(
  async (_options: UninitOptions, { uninitCommand }: { uninitCommand: UninitCommand }) => {
    await uninitCommand.execute();
  },
  withConfigMiddleware
);

/**
 * Executable runner for the uninit command.
 */
export const runUninit = createCliRunner(handleUninit);

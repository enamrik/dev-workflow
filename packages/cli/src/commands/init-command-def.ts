/**
 * Init Command Handler and Runner
 *
 * Uses the Awilix DI pattern with InitCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import type { InitCommand, InitOptions } from "./init-command.js";

/**
 * Handler - thin wrapper that destructures just what it needs (the command).
 */
export const handleInit = createCliHandler(
  async (options: InitOptions, { initCommand }: { initCommand: InitCommand }) => {
    await initCommand.execute(options);
  },
  defaultMiddleware
);

/**
 * Executable runner for the init command.
 */
export const runInit = createCliCommand(handleInit);

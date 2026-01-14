/**
 * UI Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with UICommand class for testability.
 */

import { createCliHandler, createCliRunner, defaultMiddleware } from "../di/bootstrap.js";
import type { UICommand } from "./ui-command.js";

/**
 * Options for UI commands (currently no options)
 */
export type UIOptions = Record<string, never>;

/**
 * Handler for ui (start) command.
 */
export const handleUI = createCliHandler(
  async (_options: UIOptions, { uiCommand }: { uiCommand: UICommand }) => {
    await uiCommand.start();
  },
  defaultMiddleware
);

/**
 * Handler for ui:install command.
 */
export const handleUIInstall = createCliHandler(
  async (_options: UIOptions, { uiCommand }: { uiCommand: UICommand }) => {
    await uiCommand.install();
  },
  defaultMiddleware
);

/**
 * Handler for ui:uninstall command.
 */
export const handleUIUninstall = createCliHandler(
  async (_options: UIOptions, { uiCommand }: { uiCommand: UICommand }) => {
    await uiCommand.uninstall();
  },
  defaultMiddleware
);

/**
 * Executable runners.
 */
export const runUI = createCliRunner(handleUI);
export const runUIInstall = createCliRunner(handleUIInstall);
export const runUIUninstall = createCliRunner(handleUIUninstall);

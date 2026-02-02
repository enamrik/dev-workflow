/**
 * UI Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with UICommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UICommandTag } from "../di/cli-tags.js";

/**
 * Options for UI commands (currently no options)
 */
export type UIOptions = Record<string, never>;

/**
 * Handler for ui (start) command.
 */
export const handleUI = createCliHandler({
  handler: (_options: UIOptions) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.start());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for ui:install command.
 */
export const handleUIInstall = createCliHandler({
  handler: (_options: UIOptions) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.install());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for ui:uninstall command.
 */
export const handleUIUninstall = createCliHandler({
  handler: (_options: UIOptions) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.uninstall());
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runners.
 */
export const runUI = createCliCommand(handleUI);
export const runUIInstall = createCliCommand(handleUIInstall);
export const runUIUninstall = createCliCommand(handleUIUninstall);

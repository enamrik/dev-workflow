/**
 * UI Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with UICommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UICommandTag } from "../di/cli-tags.js";

/** Options for the `ui` command. */
export interface UIOptions {
  foreground?: boolean;
}

/** Handler for `ui` (start daemon; --foreground runs attached). */
export const handleUI = createCliHandler({
  handler: (options: UIOptions) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.start({ foreground: options.foreground === true }));
    }),
  middleware: defaultMiddleware,
});

/** Handler for `ui:stop`. */
export const handleUIStop = createCliHandler({
  handler: (_options: Record<string, never>) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.stop());
    }),
  middleware: defaultMiddleware,
});

/** Handler for `ui:status`. */
export const handleUIStatus = createCliHandler({
  handler: (_options: Record<string, never>) =>
    Effect.gen(function* () {
      const uiCommand = yield* UICommandTag;
      yield* Effect.promise(() => uiCommand.status());
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runners.
 */
export const runUI = createCliCommand(handleUI);
export const runUIStop = createCliCommand(handleUIStop);
export const runUIStatus = createCliCommand(handleUIStatus);

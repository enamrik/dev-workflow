/**
 * Worker Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with WorkerCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { WorkerCommandTag } from "../di/cli-tags.js";
import type { StartWorkerOptions } from "./worker-command.js";

/**
 * Options for workers list command (currently no options)
 */
export type WorkersOptions = Record<string, never>;

/**
 * Handler for workers (list) command.
 */
export const handleWorkers = createCliHandler({
  handler: (_options: WorkersOptions) =>
    Effect.gen(function* () {
      const workerCommand = yield* WorkerCommandTag;
      yield* Effect.promise(() => workerCommand.list());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for claude (start worker) command.
 */
export const handleClaudeWorker = createCliHandler({
  handler: (options: StartWorkerOptions) =>
    Effect.gen(function* () {
      const workerCommand = yield* WorkerCommandTag;
      yield* Effect.promise(() => workerCommand.start(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runners.
 */
export const runWorkers = createCliCommand(handleWorkers);
export const runClaudeWorker = createCliCommand(handleClaudeWorker);

/**
 * Worker Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with WorkerCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { WorkerCommandTag } from "../di/cli-tags.js";
import type { StartWorkerOptions, WorkerLogsOptions } from "./worker-command.js";

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
 * Handler for the `claude` command — runs the long-lived worker SUPERVISOR,
 * which spawns the worker loop as a replaceable child (the hidden
 * `__worker-run` verb) and relaunches it per the exit-code protocol.
 */
export const handleSuperviseWorker = createCliHandler({
  handler: (options: StartWorkerOptions) =>
    Effect.gen(function* () {
      const workerCommand = yield* WorkerCommandTag;
      yield* Effect.promise(() => workerCommand.supervise(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for worker:logs command — locate/tail per-task worker session logs.
 */
export const handleWorkerLogs = createCliHandler({
  handler: (options: WorkerLogsOptions) =>
    Effect.gen(function* () {
      const workerCommand = yield* WorkerCommandTag;
      yield* Effect.promise(() => workerCommand.logs(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runners.
 */
export const runWorkers = createCliCommand(handleWorkers);
export const runSuperviseWorker = createCliCommand(handleSuperviseWorker);
export const runWorkerLogs = createCliCommand(handleWorkerLogs);

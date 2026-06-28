/**
 * Worker-Run Command Handler and Runner
 *
 * Backs the HIDDEN `dfl __worker-run` verb — the replaceable child process the
 * WorkerSupervisor spawns. The child IS today's worker: it resolves the same
 * WorkerCommand and calls the SAME `start(options)` (the existing poll/claim/
 * work loop). The supervisor (`dfl claude`) owns the terminal and relaunch
 * policy; this verb owns the actual work.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { WorkerCommandTag } from "../di/cli-tags.js";
import type { StartWorkerOptions } from "./worker-command.js";

/**
 * Handler for the hidden __worker-run command — runs the existing worker loop.
 */
export const handleWorkerRun = createCliHandler({
  handler: (options: StartWorkerOptions) =>
    Effect.gen(function* () {
      const workerCommand = yield* WorkerCommandTag;
      yield* Effect.promise(() => workerCommand.start(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Executable runner.
 */
export const runWorkerRun = createCliCommand(handleWorkerRun);

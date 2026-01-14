/**
 * Worker Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with WorkerCommand class for testability.
 */

import { createCliHandler, createCliRunner, defaultMiddleware } from "../di/bootstrap.js";
import type { WorkerCommand, StartWorkerOptions } from "./worker-command.js";

/**
 * Options for workers list command (currently no options)
 */
export type WorkersOptions = Record<string, never>;

/**
 * Handler for workers (list) command.
 */
export const handleWorkers = createCliHandler(
  async (_options: WorkersOptions, { workerCommand }: { workerCommand: WorkerCommand }) => {
    await workerCommand.list();
  },
  defaultMiddleware
);

/**
 * Handler for claude (start worker) command.
 */
export const handleClaudeWorker = createCliHandler(
  async (options: StartWorkerOptions, { workerCommand }: { workerCommand: WorkerCommand }) => {
    await workerCommand.start(options);
  },
  defaultMiddleware
);

/**
 * Executable runners.
 */
export const runWorkers = createCliRunner(handleWorkers);
export const runClaudeWorker = createCliRunner(handleClaudeWorker);

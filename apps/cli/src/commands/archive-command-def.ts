/**
 * Archive Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with ArchiveCommand, UnarchiveCommand, and NukeCommand classes.
 */

import {
  createCliHandler,
  createCliCommand,
  withConfigMiddleware,
  withResolverMiddleware,
} from "../di/bootstrap.js";
import type {
  ArchiveCommand,
  UnarchiveCommand,
  NukeCommand,
  NukeOptions,
} from "./archive-command.js";

/**
 * Options for archive command (currently no options)
 */
export type ArchiveOptions = Record<string, never>;

/**
 * Handler for archive command.
 */
export const handleArchive = createCliHandler(
  async (_options: ArchiveOptions, { archiveCommand }: { archiveCommand: ArchiveCommand }) => {
    await archiveCommand.execute();
  },
  withConfigMiddleware
);

/**
 * Handler for unarchive command.
 * Uses resolver-only middleware since archived projects may not have full config.
 */
export const handleUnarchive = createCliHandler(
  async (
    _options: ArchiveOptions,
    { unarchiveCommand }: { unarchiveCommand: UnarchiveCommand }
  ) => {
    await unarchiveCommand.execute();
  },
  withResolverMiddleware
);

/**
 * Handler for nuke command.
 */
export const handleNuke = createCliHandler(
  async (options: NukeOptions, { nukeCommand }: { nukeCommand: NukeCommand }) => {
    await nukeCommand.execute(options);
  },
  withConfigMiddleware
);

/**
 * Executable runners.
 */
export const runArchive = createCliCommand(handleArchive);
export const runUnarchive = createCliCommand(handleUnarchive);
export const runNuke = createCliCommand(handleNuke);

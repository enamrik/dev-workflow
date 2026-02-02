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
import { Effect } from "@dev-workflow/effect";
import { ArchiveCommandTag, UnarchiveCommandTag, NukeCommandTag } from "../di/cli-tags.js";
import type { NukeOptions } from "./archive-command.js";

/**
 * Options for archive command (currently no options)
 */
export type ArchiveOptions = Record<string, never>;

/**
 * Handler for archive command.
 */
export const handleArchive = createCliHandler({
  handler: (_options: ArchiveOptions) =>
    Effect.gen(function* () {
      const archiveCommand = yield* ArchiveCommandTag;
      yield* Effect.promise(() => archiveCommand.execute());
    }),
  middleware: withConfigMiddleware,
});

/**
 * Handler for unarchive command.
 * Uses resolver-only middleware since archived projects may not have full config.
 */
export const handleUnarchive = createCliHandler({
  handler: (_options: ArchiveOptions) =>
    Effect.gen(function* () {
      const unarchiveCommand = yield* UnarchiveCommandTag;
      yield* Effect.promise(() => unarchiveCommand.execute());
    }),
  middleware: withResolverMiddleware,
});

/**
 * Handler for nuke command.
 */
export const handleNuke = createCliHandler({
  handler: (options: NukeOptions) =>
    Effect.gen(function* () {
      const nukeCommand = yield* NukeCommandTag;
      yield* Effect.promise(() => nukeCommand.execute(options));
    }),
  middleware: withConfigMiddleware,
});

/**
 * Executable runners.
 */
export const runArchive = createCliCommand(handleArchive);
export const runUnarchive = createCliCommand(handleUnarchive);
export const runNuke = createCliCommand(handleNuke);

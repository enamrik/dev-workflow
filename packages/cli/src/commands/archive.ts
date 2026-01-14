/**
 * Archive Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with ArchiveCommand, UnarchiveCommand, and NukeCommand classes.
 */

import { asValue } from "awilix";
import {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
  resolveConfigFromGit,
  ProjectConfigError,
} from "@dev-workflow/core";
import {
  createCliHandler,
  createCliRunner,
  defaultMiddleware,
  composeMiddleware,
  type ContainerMiddleware,
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
 * Middleware to resolve config from git for archive/nuke commands.
 */
const resolveConfigMiddleware: ContainerMiddleware = async (container) => {
  const workingDirectory = container.cradle.workingDirectory;

  let config;
  try {
    config = await resolveConfigFromGit(workingDirectory);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      if (error.code === "NOT_GIT_REPO") {
        console.error("❌ Not a git repository. dev-workflow requires git.");
      } else if (error.code === "SLUG_NOT_FOUND" || error.code === "CONFIG_NOT_FOUND") {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nRun: dev-workflow init");
      } else if (error.code === "WORKTREE_DETECTED") {
        console.error("❌ Cannot run this command from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  container.register({
    trackDirectoryResolver: asValue(resolver),
    config: asValue(config),
    databaseConnectionString: asValue(config.database),
  });
};

/**
 * Middleware for unarchive - only needs resolver, not full config.
 */
const unarchiveMiddleware: ContainerMiddleware = async (container) => {
  const workingDirectory = container.cradle.workingDirectory;

  try {
    const resolver = createTrackDirectoryResolver(workingDirectory);
    container.register({
      trackDirectoryResolver: asValue(resolver),
    });
  } catch (_error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }
};

/**
 * Handler for archive command.
 */
export const handleArchive = createCliHandler(
  async (_options: ArchiveOptions, { archiveCommand }: { archiveCommand: ArchiveCommand }) => {
    await archiveCommand.execute();
  },
  composeMiddleware(defaultMiddleware, resolveConfigMiddleware)
);

/**
 * Handler for unarchive command.
 */
export const handleUnarchive = createCliHandler(
  async (
    _options: ArchiveOptions,
    { unarchiveCommand }: { unarchiveCommand: UnarchiveCommand }
  ) => {
    await unarchiveCommand.execute();
  },
  composeMiddleware(defaultMiddleware, unarchiveMiddleware)
);

/**
 * Handler for nuke command.
 */
export const handleNuke = createCliHandler(
  async (options: NukeOptions, { nukeCommand }: { nukeCommand: NukeCommand }) => {
    await nukeCommand.execute(options);
  },
  composeMiddleware(defaultMiddleware, resolveConfigMiddleware)
);

/**
 * Executable runners.
 */
export const runArchive = createCliRunner(handleArchive);
export const runUnarchive = createCliRunner(handleUnarchive);
export const runNuke = createCliRunner(handleNuke);

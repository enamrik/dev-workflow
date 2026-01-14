/**
 * Update Command Handler and Runner
 *
 * Uses the Awilix DI pattern with UpdateCommand class for testability.
 */

import { asValue } from "awilix";
import {
  TrackDirectoryResolver,
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
import type { UpdateCommand } from "./update-command.js";

/**
 * Options for the update command (currently no options)
 */
export type UpdateOptions = Record<string, never>;

/**
 * Middleware to resolve config from git and register dependencies.
 */
const resolveConfigMiddleware: ContainerMiddleware = async (container) => {
  const workingDirectory = container.cradle.workingDirectory;

  // Resolve config from git
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
        console.error("❌ Cannot run update from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  // Register dependencies
  container.register({
    trackDirectoryResolver: asValue(resolver),
    databaseConnectionString: asValue(config.database),
  });
};

/**
 * Handler - thin wrapper that destructures just what it needs (the command).
 */
export const handleUpdate = createCliHandler(
  async (_options: UpdateOptions, { updateCommand }: { updateCommand: UpdateCommand }) => {
    await updateCommand.execute();
  },
  composeMiddleware(defaultMiddleware, resolveConfigMiddleware)
);

/**
 * Executable runner for the update command.
 */
export const runUpdate = createCliRunner(handleUpdate);

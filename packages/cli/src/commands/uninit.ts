/**
 * Uninit Command
 *
 * Removes dev-workflow Claude integration (skills, MCP) while preserving project data.
 * Uses the Awilix DI pattern with tool classes for testability.
 */

import { asValue } from "awilix";
import { TrackDirectoryResolver, resolveConfigFromGit } from "@dev-workflow/core";
import {
  createCliHandler,
  createCliRunner,
  defaultMiddleware,
  composeMiddleware,
  type ContainerMiddleware,
} from "../di/bootstrap.js";
import type { UninitTool } from "../tools/uninit-tool.js";

/**
 * Options for the uninit command (currently no options)
 */
export type UninitOptions = Record<string, never>;

/**
 * Middleware to resolve config from git and register trackDirectoryResolver.
 *
 * This resolves config from .git/config → ~/.track/<slug>/config.json.
 * Throws ProjectConfigError if not initialized, which is caught by createCliHandler.
 */
const resolveConfigMiddleware: ContainerMiddleware = async (container) => {
  const workingDirectory = container.cradle.workingDirectory;

  // Resolve config from git
  const config = await resolveConfigFromGit(workingDirectory);

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  // Override the trackDirectoryResolver with the resolved one
  container.register({
    trackDirectoryResolver: asValue(resolver),
  });
};

/**
 * Handler - thin wrapper that destructures just what it needs (the tool).
 */
export const handleUninit = createCliHandler(
  async (_options: UninitOptions, { uninitTool }: { uninitTool: UninitTool }) => {
    await uninitTool.uninit();
  },
  composeMiddleware(defaultMiddleware, resolveConfigMiddleware)
);

/**
 * Executable runner for the uninit command.
 */
export const runUninit = createCliRunner(handleUninit);

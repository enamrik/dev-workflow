/**
 * Uninit Command
 *
 * Removes dev-workflow Claude integration (skills, MCP) while preserving project data.
 * Uses the new Awilix DI pattern for testability and consistent error handling.
 */

import { asValue } from "awilix";
import { TrackDirectoryResolver, resolveConfigFromGit } from "@dev-workflow/core";
import { UninstallService } from "../application/uninstall.service.js";
import {
  createCommand,
  createCommandHandler,
  defaultMiddleware,
  compose,
  type CliHandler,
  type CliMiddleware,
} from "../di/index.js";
import type { CliCradle } from "../di/container.js";

/**
 * Options for the uninit command (currently no options)
 */
export type UninitOptions = Record<string, never>;

/**
 * Middleware to resolve config from git and register trackDirectoryResolver.
 *
 * This resolves config from .git/config → ~/.track/<slug>/config.json.
 * Throws ProjectConfigError if not initialized, which is caught by createCommand.
 */
const resolveConfigMiddleware: CliMiddleware<UninitOptions> = async (_opts, container) => {
  const workingDirectory = container.cradle.workingDirectory;

  // Resolve config from git
  const config = await resolveConfigFromGit(workingDirectory);

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  // Register the resolver
  container.register({
    trackDirectoryResolver: asValue(resolver),
  });
};

/**
 * Core uninit handler logic.
 *
 * This function contains the business logic for removing dev-workflow integration.
 * It receives all dependencies via the cradle, making it testable.
 */
const uninitHandler: CliHandler<UninitOptions> = async (_options, cradle: CliCradle) => {
  // Create the uninstall service with resolved dependencies
  const uninstallService = new UninstallService(
    cradle.fileSystem,
    cradle.workingDirectory,
    cradle.trackDirectoryResolver
  );

  console.log("🗑️  Removing dev-workflow Claude integration...");

  await uninstallService.removeSkills();
  console.log("✓ Removed skills");

  await uninstallService.unregisterMCPServer();
  console.log("✓ Unregistered MCP server");

  console.log("\n✨ dev-workflow Claude integration removed!");
  console.log("\nPreserved:");
  console.log("- Project data in ~/.track/ (issues, plans, tasks)");
  console.log("- .claude/config/ (your Claude Code configuration)");
  console.log("\nTo fully remove project data, use: dev-workflow nuke");
  console.log("To archive (hide but preserve data), use: dev-workflow archive");
};

/**
 * Wrapped command with middleware and error handling.
 *
 * Middleware chain:
 * 1. defaultMiddleware - registers workingDirectory and packageRoot
 * 2. resolveConfigMiddleware - resolves config and registers trackDirectoryResolver
 */
const command = createCommand(uninitHandler, compose(defaultMiddleware, resolveConfigMiddleware));

/**
 * Executable handler for the uninit command.
 */
export const runUninit = createCommandHandler(command);

/**
 * Uninit Command
 *
 * Removes dev-workflow Claude integration (skills, MCP) while preserving project data.
 * Uses the new Awilix DI pattern for testability and consistent error handling.
 */

import { asValue } from "awilix";
import { TrackDirectoryResolver, resolveConfigFromGit } from "@dev-workflow/core";
import { UninstallService } from "../application/uninstall.service.js";
import { createCommand, createCommandHandler, type CommandHandler } from "../di/index.js";

/**
 * Options for the uninit command (currently no options)
 */
export type UninitOptions = Record<string, never>;

/**
 * Dependencies required by the uninit handler
 */
interface UninitDeps {
  uninstallService: UninstallService;
}

/**
 * Core uninit handler logic.
 *
 * This function contains the business logic for removing dev-workflow integration.
 * It receives all dependencies via injection, making it testable without static mocks.
 */
const uninitHandler: CommandHandler<UninitOptions, UninitDeps> = async (
  _options,
  { uninstallService }
) => {
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
 * Wrapped command with error handling
 */
const command = createCommand(uninitHandler);

/**
 * Create the uninit handler with custom container initialization.
 *
 * Since uninit needs to resolve config from git to get the TrackDirectoryResolver,
 * we use a custom initializer that:
 * 1. Resolves config from git
 * 2. Creates a resolver from the config
 * 3. Registers the resolver so depsSelector can create the UninstallService
 */
export const runUninit = createCommandHandler<UninitOptions, UninitDeps>(
  command,
  (cradle) => {
    // Create the uninstall service with resolved dependencies
    return {
      uninstallService: new UninstallService(
        cradle.fileSystem,
        cradle.workingDirectory,
        cradle.trackDirectoryResolver
      ),
    };
  },
  {
    // Custom initializer to resolve config from git first
    initializer: async (container, context) => {
      // Register basic values first
      container.register({
        workingDirectory: asValue(context.workingDirectory),
        packageRoot: asValue(context.packageRoot),
      });

      // Resolve config from .git/config → ~/.track/<slug>/config.json
      // This will throw ProjectConfigError if not initialized, which is caught by createCommandHandler
      const config = await resolveConfigFromGit(context.workingDirectory);

      // Create a resolver from the config (gitRoot + slug)
      const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

      // Override the trackDirectoryResolver with the resolved one
      container.register({
        trackDirectoryResolver: asValue(resolver),
      });
    },
  }
);

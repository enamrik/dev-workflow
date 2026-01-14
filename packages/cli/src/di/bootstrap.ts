/**
 * CLI Bootstrap Functions
 *
 * Provides wrapper functions for CLI command handlers that:
 * 1. createCommand() - Wraps handler with CLI-specific error handling (console output + exit codes)
 * 2. createCommandHandler() - Creates transient container, runs command, disposes container
 *
 * These functions separate the command's business logic from infrastructure concerns,
 * enabling unit testing with scoped test containers.
 *
 * @example
 * ```typescript
 * // Define command handler with dependencies
 * async function updateHandler(
 *   options: UpdateOptions,
 *   deps: { updateService: UpdateService }
 * ): Promise<void> {
 *   await deps.updateService.updateSkills();
 * }
 *
 * // Wrap with error handling
 * const command = createCommand(updateHandler);
 *
 * // Create executable handler with DI
 * export const runUpdate = createCommandHandler(
 *   command,
 *   (cradle) => ({ updateService: new UpdateService(cradle.fileSystem, ...) })
 * );
 * ```
 */

import { asValue } from "awilix";
import {
  ProjectConfigError,
  ValidationError,
  EntityNotFoundError,
  BusinessRuleError,
} from "@dev-workflow/core";
import { createCliContainer, type CliCradle, type CliContainer } from "./container.js";

/**
 * CLI validation error for simple user input errors.
 * Use this for CLI-specific validation with simple string messages.
 * For domain validation (field + reason), use ValidationError from core.
 */
export class CliValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

/**
 * Type for a command handler function.
 *
 * The handler receives:
 * - options: Command-line options from commander
 * - deps: Dependencies selected from the container cradle
 */
export type CommandHandler<TOpts, TDeps> = (options: TOpts, deps: TDeps) => Promise<void>;

/**
 * Type for a dependency selector function.
 *
 * Maps the full container cradle to the specific dependencies needed by a command.
 */
export type DepsSelector<TDeps> = (cradle: CliCradle) => TDeps;

/**
 * Handle CLI errors by converting them to appropriate console output and exit codes.
 *
 * This is the centralized error handler for all CLI commands.
 * Errors from both initialization and command execution are handled here.
 *
 * Error mapping:
 * - CliValidationError → "❌ Invalid: ..." + exit(1) (simple CLI validation)
 * - ValidationError → "❌ Invalid: ..." + exit(1) (core domain validation)
 * - EntityNotFoundError → "❌ Not found: ..." + exit(1)
 * - BusinessRuleError → "❌ ..." + exit(1)
 * - ProjectConfigError → Specific message based on error code + exit(1)
 * - Other errors → "❌ Error: ..." + exit(1)
 */
export function handleCliError(error: unknown): never {
  // Handle CLI-specific validation errors (simple string messages)
  if (error instanceof CliValidationError) {
    console.error(`❌ Invalid: ${error.message}`);
    process.exit(1);
  }

  // Handle validation errors (from core - field + reason)
  if (error instanceof ValidationError) {
    console.error(`❌ Invalid: ${error.message}`);
    process.exit(1);
  }

  // Handle entity not found errors (from core)
  if (error instanceof EntityNotFoundError) {
    console.error(`❌ Not found: ${error.message}`);
    process.exit(1);
  }

  // Handle business rule errors (from core)
  if (error instanceof BusinessRuleError) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  // Handle project config errors with specific messages
  if (error instanceof ProjectConfigError) {
    switch (error.code) {
      case "NOT_GIT_REPO":
        console.error("❌ Not a git repository. dev-workflow requires git.");
        break;
      case "SLUG_NOT_FOUND":
      case "CONFIG_NOT_FOUND":
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nRun: dev-workflow init");
        break;
      case "WORKTREE_DETECTED":
        console.error("❌ Cannot run this command from a git worktree.");
        console.error("   Run this command from the main repository.");
        break;
      default:
        console.error(`❌ ${error.message}`);
    }
    process.exit(1);
  }

  // Handle generic errors
  console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/**
 * Wrap a command handler with CLI-specific error handling.
 *
 * This function catches errors and converts them to appropriate console output
 * and exit codes. Domain errors are presented in a user-friendly format.
 *
 * Use this when you want to call a handler directly (e.g., in tests) while
 * still getting proper error handling.
 *
 * @param handler - The command handler function
 * @returns Wrapped handler with error handling
 */
export function createCommand<TOpts, TDeps>(
  handler: CommandHandler<TOpts, TDeps>
): CommandHandler<TOpts, TDeps> {
  return async (options: TOpts, deps: TDeps): Promise<void> => {
    try {
      await handler(options, deps);
    } catch (error) {
      handleCliError(error);
    }
  };
}

/**
 * Context passed to the container initializer function.
 * Contains runtime values that need to be registered in the container.
 */
export interface CommandContext {
  /** Current working directory */
  workingDirectory: string;
  /** CLI package root directory */
  packageRoot: string;
}

/**
 * Type for a function that initializes additional container registrations.
 * This is called before the command runs to set up runtime values.
 * Can be synchronous or asynchronous.
 */
export type ContainerInitializer = (
  container: CliContainer,
  context: CommandContext
) => void | Promise<void>;

/**
 * Default container initializer that registers workingDirectory and packageRoot.
 */
const defaultInitializer: ContainerInitializer = (container, context) => {
  container.register({
    workingDirectory: asValue(context.workingDirectory),
    packageRoot: asValue(context.packageRoot),
  });
};

/**
 * Create a command handler that manages the container lifecycle.
 *
 * This is the main entry point for creating CLI commands with DI.
 * It handles:
 * 1. Creating a transient container
 * 2. Registering runtime values (workingDirectory, packageRoot)
 * 3. Selecting dependencies from the cradle
 * 4. Running the command
 * 5. Disposing the container
 *
 * @param command - The wrapped command handler (from createCommand)
 * @param depsSelector - Function to select dependencies from the cradle
 * @param options - Optional configuration for the command handler
 * @returns Executable command function for use with commander
 *
 * @example
 * ```typescript
 * export const runUpdate = createCommandHandler(
 *   createCommand(updateHandler),
 *   (cradle) => ({
 *     fileSystem: cradle.fileSystem,
 *     resolver: cradle.trackDirectoryResolver,
 *   })
 * );
 *
 * // In commander setup:
 * program.command('update').action(runUpdate);
 * ```
 */
export function createCommandHandler<TOpts, TDeps>(
  command: CommandHandler<TOpts, TDeps>,
  depsSelector: DepsSelector<TDeps>,
  options?: {
    /**
     * Custom container initializer. If not provided, uses default which
     * registers workingDirectory and packageRoot.
     */
    initializer?: ContainerInitializer;
    /**
     * Override the package root. If not provided, defaults to CLI package root.
     */
    getPackageRoot?: () => string;
  }
): (opts: TOpts) => Promise<void> {
  const initializer = options?.initializer ?? defaultInitializer;
  const getPackageRoot = options?.getPackageRoot ?? (() => getDefaultPackageRoot());

  return async (opts: TOpts): Promise<void> => {
    const container = createCliContainer();

    try {
      // Initialize container with runtime values
      const context: CommandContext = {
        workingDirectory: process.cwd(),
        packageRoot: getPackageRoot(),
      };
      // Await the initializer in case it's async
      await initializer(container, context);

      // Select dependencies and run command
      const deps = depsSelector(container.cradle);
      await command(opts, deps);
    } catch (error) {
      // Handle errors from initialization or command execution
      handleCliError(error);
    } finally {
      // Always dispose container (cleanup connections, etc.)
      await container.dispose();
    }
  };
}

/**
 * Get the default CLI package root directory.
 *
 * In development: packages/cli/dist → packages/cli
 * In production: node_modules/@dev-workflow/cli/dist → node_modules/@dev-workflow/cli
 */
function getDefaultPackageRoot(): string {
  // import.meta.url gives us the URL of this module file
  // We need to go up from dist/di/ to the package root
  const url = new URL(import.meta.url);
  const currentFile = url.pathname;
  // Go up: bootstrap.js → di → dist → package root
  const distDir = currentFile.substring(0, currentFile.lastIndexOf("/di/"));
  return distDir.substring(0, distDir.lastIndexOf("/dist"));
}

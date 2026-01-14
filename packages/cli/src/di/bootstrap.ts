/**
 * CLI Bootstrap Functions
 *
 * Provides wrapper functions for CLI command handlers:
 * 1. createCommand(handler, middleware?) - Wraps handler with middleware + error handling
 * 2. createCommandHandler(command) - Creates transient container, runs command, disposes
 *
 * @example
 * ```typescript
 * // Define middleware for common setup
 * const registerWorkingDir: CliMiddleware = (opts, container) => {
 *   container.register({ workingDirectory: asValue(process.cwd()) });
 * };
 *
 * // Define handler that uses cradle dependencies
 * async function uninitHandler(options: UninitOptions, cradle: CliCradle): Promise<void> {
 *   const service = new UninstallService(cradle.fileSystem, ...);
 *   await service.uninstall();
 * }
 *
 * // Compose command with middleware
 * export const command = createCommand(uninitHandler, compose(registerWorkingDir, resolveConfig));
 *
 * // Create executable handler
 * export const runUninit = createCommandHandler(command);
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
 */
export class CliValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

/**
 * Middleware function that operates on (options, container).
 * Use to inject dynamic values into the container before handler runs.
 */
export type CliMiddleware<TOpts = unknown> = (
  options: TOpts,
  container: CliContainer
) => Promise<void> | void;

/**
 * Handler function that operates on (options, cradle).
 * Contains the command's business logic.
 */
export type CliHandler<TOpts = unknown> = (options: TOpts, cradle: CliCradle) => Promise<void>;

/**
 * Command function that operates on (options, container).
 * This is what createCommand produces.
 */
export type CliCommand<TOpts = unknown> = (
  options: TOpts,
  container: CliContainer
) => Promise<void>;

/**
 * Handle CLI errors by converting them to console output and exit codes.
 *
 * Error mapping:
 * - CliValidationError → "❌ Invalid: ..." + exit(1)
 * - ValidationError → "❌ Invalid: ..." + exit(1)
 * - EntityNotFoundError → "❌ Not found: ..." + exit(1)
 * - BusinessRuleError → "❌ ..." + exit(1)
 * - ProjectConfigError → Specific message based on error code + exit(1)
 * - Other errors → "❌ Error: ..." + exit(1)
 */
export function handleCliError(error: unknown): never {
  if (error instanceof CliValidationError) {
    console.error(`❌ Invalid: ${error.message}`);
    process.exit(1);
  }

  if (error instanceof ValidationError) {
    console.error(`❌ Invalid: ${error.message}`);
    process.exit(1);
  }

  if (error instanceof EntityNotFoundError) {
    console.error(`❌ Not found: ${error.message}`);
    process.exit(1);
  }

  if (error instanceof BusinessRuleError) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

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
        break;
      default:
        console.error(`❌ ${error.message}`);
    }
    process.exit(1);
  }

  console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/**
 * Compose multiple CLI middleware functions into a single middleware.
 *
 * Middleware is executed in order. Each middleware can:
 * - Complete successfully → next middleware runs
 * - Throw an error → chain stops, error propagates
 *
 * @param middlewares - Array of middleware functions to compose
 * @returns A single middleware that runs all composed middleware in order
 */
export function compose<TOpts>(...middlewares: CliMiddleware<TOpts>[]): CliMiddleware<TOpts> {
  return async (options: TOpts, container: CliContainer): Promise<void> => {
    for (const middleware of middlewares) {
      await middleware(options, container);
    }
  };
}

/**
 * Common middleware: registers workingDirectory in container.
 */
export const registerWorkingDirectory: CliMiddleware = (_opts, container) => {
  container.register({
    workingDirectory: asValue(process.cwd()),
  });
};

/**
 * Common middleware: registers packageRoot in container.
 */
export const registerPackageRoot: CliMiddleware = (_opts, container) => {
  container.register({
    packageRoot: asValue(getDefaultPackageRoot()),
  });
};

/**
 * Default middleware chain for most commands.
 */
export const defaultMiddleware = compose(registerWorkingDirectory, registerPackageRoot);

/**
 * Wrap a handler with optional middleware and error handling.
 *
 * @param handler - The handler function (options, cradle) => Promise<void>
 * @param middleware - Optional middleware chain to run before handler
 * @returns Command function (options, container) => Promise<void>
 */
export function createCommand<TOpts>(
  handler: CliHandler<TOpts>,
  middleware?: CliMiddleware<TOpts>
): CliCommand<TOpts> {
  return async (options: TOpts, container: CliContainer): Promise<void> => {
    try {
      // Run middleware if provided
      if (middleware) {
        await middleware(options, container);
      }
      // Run handler with cradle
      await handler(options, container.cradle);
    } catch (error) {
      handleCliError(error);
    }
  };
}

/**
 * Create an executable command handler that manages container lifecycle.
 *
 * @param command - The command function from createCommand
 * @returns Executable function for use with commander
 */
export function createCommandHandler<TOpts>(
  command: CliCommand<TOpts>
): (options: TOpts) => Promise<void> {
  return async (options: TOpts): Promise<void> => {
    const container = createCliContainer();
    try {
      await command(options, container);
    } finally {
      await container.dispose();
    }
  };
}

/**
 * Get the CLI package root directory.
 */
function getDefaultPackageRoot(): string {
  const url = new URL(import.meta.url);
  const currentFile = url.pathname;
  const distDir = currentFile.substring(0, currentFile.lastIndexOf("/di/"));
  return distDir.substring(0, distDir.lastIndexOf("/dist"));
}

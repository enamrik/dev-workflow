/**
 * CLI Handler Bootstrap
 *
 * Provides utilities for creating CLI command handlers with:
 * - Container middleware (for registering dynamic values)
 * - Dependency injection from Awilix cradle
 * - Consistent error handling (console output + exit codes)
 *
 * Design (mirrors MCP pattern with CLI-specific container middleware):
 * - Tool classes encapsulate business logic with constructor DI
 * - Handlers are thin wrappers: (opts, { tool }) => tool.action()
 * - Container middleware injects dynamic values before handler runs
 * - createCliHandler wraps with error handling: (opts, cradle) => void
 * - createCliRunner binds to container: (opts) => void
 *
 * @example
 * ```typescript
 * // 1. Tool class with constructor DI
 * class UninitTool {
 *   constructor(private readonly uninstallService: UninstallService) {}
 *   async uninit(): Promise<void> { ... }
 * }
 *
 * // 2. Container middleware - registers dynamic values
 * const resolveConfigMiddleware: ContainerMiddleware = async (container) => {
 *   const config = await resolveConfigFromGit(container.cradle.workingDirectory);
 *   container.register({ trackDirectoryResolver: asValue(new Resolver(config)) });
 * };
 *
 * // 3. Handler - thin wrapper that destructures what it needs
 * export const handleUninit = createCliHandler(
 *   async (_opts: UninitOptions, { uninitTool }: { uninitTool: UninitTool }) => {
 *     await uninitTool.uninit();
 *   },
 *   resolveConfigMiddleware
 * );
 *
 * // 4. Runner - binds to container for CLI entry point
 * const container = createCliContainer();
 * const runUninit = createCliRunner(handleUninit, container);
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

// =============================================================================
// Type Definitions
// =============================================================================

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
 * A handler function that receives options and cradle.
 * Handler destructures what it needs from cradle (typically just the tool class).
 */
export type CliHandler<TOpts, TCradle = CliCradle> = (
  options: TOpts,
  cradle: TCradle
) => Promise<void> | void;

/**
 * A wrapped handler with error handling.
 * Signature: (opts, container) => Promise<void>
 */
export type WrappedCliHandler<TOpts> = (options: TOpts, container: CliContainer) => Promise<void>;

/**
 * A bound runner ready for invocation.
 * Signature: (opts) => Promise<void>
 */
export type CliRunner<TOpts> = (options: TOpts) => Promise<void>;

/**
 * Container middleware for registering dynamic values.
 * Runs before handler, can access cradle and register new values.
 */
export type ContainerMiddleware = (container: CliContainer) => Promise<void> | void;

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Handle CLI errors by converting them to console output and exit codes.
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

// =============================================================================
// Middleware Composition
// =============================================================================

/**
 * Compose multiple container middleware functions into a single middleware.
 */
export function composeMiddleware(...middlewares: ContainerMiddleware[]): ContainerMiddleware {
  return async (container: CliContainer): Promise<void> => {
    for (const middleware of middlewares) {
      await middleware(container);
    }
  };
}

// =============================================================================
// Default Middleware
// =============================================================================

/**
 * Middleware: registers workingDirectory in container.
 */
export const registerWorkingDirectory: ContainerMiddleware = (container) => {
  container.register({
    workingDirectory: asValue(process.cwd()),
  });
};

/**
 * Middleware: registers packageRoot in container.
 */
export const registerPackageRoot: ContainerMiddleware = (container) => {
  container.register({
    packageRoot: asValue(getDefaultPackageRoot()),
  });
};

/**
 * Default middleware chain for most commands.
 */
export const defaultMiddleware = composeMiddleware(registerWorkingDirectory, registerPackageRoot);

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Wraps a handler with container middleware and error handling.
 * Returns: (opts, container) => Promise<void>
 *
 * @param handler - The handler function (options, cradle) => void
 * @param middleware - Optional container middleware to run before handler
 */
export function createCliHandler<TOpts, TCradle = CliCradle>(
  handler: CliHandler<TOpts, TCradle>,
  middleware?: ContainerMiddleware
): WrappedCliHandler<TOpts> {
  return async (options: TOpts, container: CliContainer): Promise<void> => {
    try {
      // Run container middleware first (can register dynamic values)
      if (middleware) {
        await middleware(container);
      }

      // Execute handler with cradle
      await handler(options, container.cradle as TCradle);
    } catch (error) {
      handleCliError(error);
    }
  };
}

// =============================================================================
// Runner Binding
// =============================================================================

/**
 * Binds a wrapped handler to a new container, disposing after execution.
 * Returns: (opts) => Promise<void>
 *
 * For CLI commands - each invocation gets a fresh container.
 *
 * @param handler - The wrapped handler from createCliHandler
 */
export function createCliRunner<TOpts>(handler: WrappedCliHandler<TOpts>): CliRunner<TOpts> {
  return async (options: TOpts): Promise<void> => {
    const container = createCliContainer();
    try {
      await handler(options, container);
    } finally {
      await container.dispose();
    }
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get the CLI package root directory.
 */
function getDefaultPackageRoot(): string {
  const url = new URL(import.meta.url);
  const currentFile = url.pathname;
  const distDir = currentFile.substring(0, currentFile.lastIndexOf("/di/"));
  return distDir.substring(0, distDir.lastIndexOf("/dist"));
}

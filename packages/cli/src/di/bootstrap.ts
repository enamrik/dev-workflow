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
 * - createCliCommand binds to container: (opts) => void
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
 * const runUninit = createCliCommand(handleUninit, container);
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
export type CliCommand<TOpts> = (options: TOpts) => Promise<void>;

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
// Project Config Middleware
// =============================================================================

/**
 * Middleware: resolves project config from git and registers in container.
 *
 * Registers:
 * - trackDirectoryResolver: TrackDirectoryResolver from gitRoot + slug
 * - config: ProjectConfig (full config object)
 * - databaseConnectionString: string (from config.database)
 *
 * Errors are handled by handleCliError (ProjectConfigError cases).
 */
export const resolveConfigMiddleware: ContainerMiddleware = async (container) => {
  const { resolveConfigFromGit, TrackDirectoryResolver } = await import("@dev-workflow/core");
  const workingDirectory = container.cradle.workingDirectory;

  const config = await resolveConfigFromGit(workingDirectory);
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  container.register({
    trackDirectoryResolver: asValue(resolver),
    config: asValue(config),
    databaseConnectionString: asValue(config.database),
  });
};

/**
 * Convenience: default middleware + config resolution.
 * Use for commands that need project config (update, uninit, archive, etc.)
 */
export const withConfigMiddleware = composeMiddleware(defaultMiddleware, resolveConfigMiddleware);

/**
 * Middleware: resolves just the trackDirectoryResolver from git (no full config).
 *
 * Use for commands that work with archived/uninitialized projects where
 * config.json may not exist (e.g., unarchive).
 *
 * Errors are handled by handleCliError (ProjectConfigError cases).
 */
export const resolveResolverMiddleware: ContainerMiddleware = async (container) => {
  const { createTrackDirectoryResolver } = await import("@dev-workflow/core");
  const workingDirectory = container.cradle.workingDirectory;

  const resolver = createTrackDirectoryResolver(workingDirectory);

  container.register({
    trackDirectoryResolver: asValue(resolver),
  });
};

/**
 * Convenience: default middleware + resolver-only resolution.
 * Use for commands that only need resolver, not full config (e.g., unarchive).
 */
export const withResolverMiddleware = composeMiddleware(
  defaultMiddleware,
  resolveResolverMiddleware
);

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
export function createCliCommand<TOpts>(handler: WrappedCliHandler<TOpts>): CliCommand<TOpts> {
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
// Test Helper
// =============================================================================

/**
 * Creates a CLI command bound to a provided test container.
 * Used for testing - allows injecting mocked dependencies.
 *
 * @param handler - The wrapped handler from createCliHandler
 * @param container - Test container with mocked dependencies
 *
 * @example
 * ```typescript
 * const container = createTestContainer();
 * container.register({ archiveService: asValue(mockArchiveService) });
 * const runArchive = createTestCliCommand(handleArchive, container);
 * await runArchive({});
 * expect(mockArchiveService.archive).toHaveBeenCalled();
 * ```
 */
export function createTestCliCommand<TOpts>(
  handler: WrappedCliHandler<TOpts>,
  container: CliContainer
): CliCommand<TOpts> {
  return async (options: TOpts): Promise<void> => {
    await handler(options, container);
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

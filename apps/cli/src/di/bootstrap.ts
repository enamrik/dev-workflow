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
 * - Handlers return Effects: (opts) => Effect<void, E, R>
 * - Container middleware injects dynamic values before handler runs
 * - createCliHandler wraps with error handling and Effect runtime
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
 * // 3. Handler - thin wrapper that yields the command from Effect context
 * export const handleUninit = createCliHandler({
 *   handler: (_opts: UninitOptions) =>
 *     Effect.gen(function* () {
 *       const uninitTool = yield* UninitToolTag;
 *       yield* Effect.promise(() => uninitTool.uninit());
 *     }),
 *   middleware: resolveConfigMiddleware,
 * });
 *
 * // 4. Runner - binds to container for CLI entry point
 * const runUninit = createCliCommand(handleUninit);
 * ```
 */

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { asValue, type AwilixContainer } from "awilix";
import {
  ProjectConfigError,
  ValidationError,
  EntityNotFoundError,
  BusinessRuleError,
} from "@dev-workflow/tracking";
import { Effect, createRuntime } from "@dev-workflow/effect";
import { createCliContainer, type CliContainer } from "./container.js";

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
 * A handler function that receives options and returns an Effect.
 * Handler uses yield* to resolve service tags from the Effect context.
 */
export type CliHandler<TOpts, E = unknown, R = never> = (options: TOpts) => Effect<void, E, R>;

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
  const { resolveConfigFromGit } = await import("@dev-workflow/tracking");
  const { TrackDirectoryResolver } = await import("@dev-workflow/git/track-directory-resolver.js");
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
  const { createTrackDirectoryResolver } =
    await import("@dev-workflow/git/track-directory-resolver.js");
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
 * @param params.handler - The handler function (options) => Effect
 * @param params.middleware - Optional container middleware to run before handler
 */
export function createCliHandler<TOpts, E, R>({
  handler,
  middleware,
}: {
  handler: CliHandler<TOpts, E, R>;
  middleware?: ContainerMiddleware;
}): WrappedCliHandler<TOpts> {
  return async (options: TOpts, container: CliContainer): Promise<void> => {
    try {
      // Run container middleware first (can register dynamic values)
      if (middleware) {
        await middleware(container);
      }

      // Run Effect with container dependencies
      // E-channel errors thrown by runEffectAndUnwrap → caught by try/catch
      // Cast is safe: runtime resolves dependencies dynamically from container cradle
      const runtime = createRuntime(container as AwilixContainer);
      await runtime.runEffectAndUnwrap(handler(options));
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
  const dir = nodePath.dirname(fileURLToPath(import.meta.url));
  // Dev (tsc) layout: <root>/dist/di/bootstrap.js → packageRoot is <root> (parent of dist),
  // where skills/ and templates/ live. Detect the "/dist/" segment and strip from there.
  const distSeg = `${nodePath.sep}dist${nodePath.sep}`;
  const distIdx = dir.lastIndexOf(distSeg);
  if (distIdx !== -1) return dir.slice(0, distIdx);
  // Bundled layout (tsup): cli.js sits in the artifact dir with skills/ + templates/
  // shipped alongside it, so the package root is simply the bundle's directory.
  return dir;
}

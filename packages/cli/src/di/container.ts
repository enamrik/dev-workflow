/**
 * CLI Dependency Injection Container
 *
 * Factory for creating transient DI containers for CLI commands.
 * CLI containers are short-lived: created per command invocation, disposed after completion.
 *
 * Lifecycle: transient (container created → command runs → container disposed)
 *
 * Unlike MCP (server lifetime) or Web (request-scoped), CLI commands are short-lived
 * processes that terminate after the command completes.
 */

import { createContainer, asClass, asFunction, InjectionMode, type AwilixContainer } from "awilix";
import {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
  DbSourceProvider,
  GitOperations,
  ProjectsResolver,
  GlobalDbWorkerQueueDb,
} from "@dev-workflow/core";
import { NodeFileSystem, type FileSystem } from "../infrastructure/file-system.js";

/**
 * Cradle interface defining all available dependencies in the CLI container.
 *
 * Services use constructor injection with these dependencies.
 */
export interface CliCradle {
  // Infrastructure (singleton within command lifecycle)
  fileSystem: FileSystem;
  gitOps: GitOperations;
  sourceProvider: DbSourceProvider;

  // Values (provided at runtime)
  workingDirectory: string;
  packageRoot: string;

  // Scoped services (lazily resolved)
  projectsResolver: ProjectsResolver;
  workerQueueDb: GlobalDbWorkerQueueDb;

  // Resolver (derived from workingDirectory)
  trackDirectoryResolver: TrackDirectoryResolver;
}

/**
 * Create a CLI DI container with registered dependencies.
 *
 * This is a factory function that creates a fresh container for each command invocation.
 * The container should be disposed after the command completes.
 *
 * @example
 * ```typescript
 * const container = createCliContainer();
 * container.register({
 *   workingDirectory: asValue(process.cwd()),
 *   packageRoot: asValue(getPackageRoot()),
 * });
 * const deps = container.cradle;
 * // ... use deps
 * await container.dispose();
 * ```
 */
export function createCliContainer(): AwilixContainer<CliCradle> {
  const container = createContainer<CliCradle>({
    injectionMode: InjectionMode.CLASSIC,
    strict: true,
  });

  container.register({
    // Infrastructure (singleton within command - reused if resolved multiple times)
    fileSystem: asClass(NodeFileSystem).singleton(),
    gitOps: asClass(GitOperations).singleton(),
    sourceProvider: asClass(DbSourceProvider)
      .singleton()
      .disposer((provider) => provider.closeAll()),

    // Scoped services (new instance per resolution)
    projectsResolver: asClass(ProjectsResolver).scoped(),
    workerQueueDb: asClass(GlobalDbWorkerQueueDb)
      .scoped()
      .disposer((db) => db.close()),

    // Resolver factory (depends on workingDirectory being registered)
    trackDirectoryResolver: asFunction(({ workingDirectory }: { workingDirectory: string }) => {
      return createTrackDirectoryResolver(workingDirectory);
    }).scoped(),
  });

  return container;
}

/**
 * Type-safe container with CLI cradle
 */
export type CliContainer = AwilixContainer<CliCradle>;

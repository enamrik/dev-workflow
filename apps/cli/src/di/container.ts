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

import {
  createContainer,
  asClass,
  asFunction,
  asValue,
  InjectionMode,
  type AwilixContainer,
} from "awilix";
import {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
} from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import {
  DbSourceProvider,
  ProjectsResolver,
  EventBus,
  type ProjectConfig,
} from "@dev-workflow/tracking";
import { NodeFileSystem, type FileSystem } from "../infrastructure/file-system.js";
import { NodeUserPrompt, type UserPrompt } from "../infrastructure/user-prompt.js";

// Application services
import { UninstallService } from "../application/uninstall.service.js";
import { InstallService } from "../application/install.service.js";
import { UpdateService } from "../application/update.service.js";
import { ClaudeConfigService } from "../application/claude-config.service.js";
import { UIService } from "../application/ui.service.js";

// Commands
import { UninitCommand } from "../commands/uninit-command.js";
import { InitCommand } from "../commands/init-command.js";
import { UpdateCommand } from "../commands/update-command.js";
import { UICommand } from "../commands/ui-command.js";
import { WorkerCommand } from "../commands/worker-command.js";
import { ClaudeConfigCommand } from "../commands/claude-config-command.js";
import { MCPCommand } from "../commands/mcp-command.js";
import { SetupCommand } from "../commands/setup-command.js";
import { UninstallCommand } from "../commands/uninstall-command.js";

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
  eventBus: EventBus;

  // Values (provided at runtime by middleware or computed)
  workingDirectory: string;
  packageRoot: string;

  // Optional values (registered by middleware for specific commands)
  trackDirectoryResolver: TrackDirectoryResolver;
  databaseConnectionString: string;
  config: ProjectConfig;

  // Scoped services (lazily resolved)
  projectsResolver: ProjectsResolver;
  workerQueueDb: GlobalDbWorkerQueueDb;

  // Application services
  uninstallService: UninstallService;
  installService: InstallService;
  updateService: UpdateService;
  claudeConfigService: ClaudeConfigService;
  uiService: UIService;
  userPrompt: UserPrompt;

  // The container itself (for services that need to register/run sub-systems)
  container: AwilixContainer<CliCradle>;

  // Commands
  uninitCommand: UninitCommand;
  initCommand: InitCommand;
  updateCommand: UpdateCommand;
  uiCommand: UICommand;
  workerCommand: WorkerCommand;
  claudeConfigCommand: ClaudeConfigCommand;
  mcpCommand: MCPCommand;
  setupCommand: SetupCommand;
  uninstallCommand: UninstallCommand;
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
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    // Infrastructure (singleton within command - reused if resolved multiple times)
    fileSystem: asClass(NodeFileSystem).singleton(),
    userPrompt: asClass(NodeUserPrompt).singleton(),
    gitOps: asClass(GitOperations).singleton(),
    eventBus: asFunction(() => new EventBus()).singleton(),
    sourceProvider: asClass(DbSourceProvider)
      .singleton()
      .disposer((provider) => provider.closeAll()),

    // Scoped services (new instance per resolution)
    projectsResolver: asClass(ProjectsResolver).scoped(),
    // Use asFunction to avoid Awilix trying to resolve optional dbPath parameter
    workerQueueDb: asFunction(() => new GlobalDbWorkerQueueDb())
      .scoped()
      .disposer((db) => db.close()),

    // Resolver factory (depends on workingDirectory being registered)
    trackDirectoryResolver: asFunction(({ workingDirectory }: { workingDirectory: string }) => {
      return createTrackDirectoryResolver(workingDirectory);
    }).scoped(),

    // Application services (lazily resolved - depend on middleware-registered values)
    uninstallService: asFunction(
      ({ fileSystem, workingDirectory }: { fileSystem: FileSystem; workingDirectory: string }) => {
        return new UninstallService(fileSystem, workingDirectory);
      }
    ).scoped(),

    installService: asFunction(
      ({
        fileSystem,
        workingDirectory,
        packageRoot,
        trackDirectoryResolver,
        sourceProvider,
        gitOps,
      }: {
        fileSystem: FileSystem;
        workingDirectory: string;
        packageRoot: string;
        trackDirectoryResolver: TrackDirectoryResolver;
        sourceProvider: DbSourceProvider;
        gitOps: GitOperations;
      }) => {
        return new InstallService(
          fileSystem,
          workingDirectory,
          packageRoot,
          trackDirectoryResolver,
          sourceProvider,
          gitOps
        );
      }
    ).scoped(),

    updateService: asFunction(
      ({
        fileSystem,
        workingDirectory,
        packageRoot,
        trackDirectoryResolver,
        databaseConnectionString,
      }: {
        fileSystem: FileSystem;
        workingDirectory: string;
        packageRoot: string;
        trackDirectoryResolver: TrackDirectoryResolver;
        databaseConnectionString: string;
      }) => {
        return new UpdateService(
          fileSystem,
          workingDirectory,
          packageRoot,
          trackDirectoryResolver,
          databaseConnectionString
        );
      }
    ).scoped(),

    claudeConfigService: asFunction(() => new ClaudeConfigService()).scoped(),

    uiService: asFunction(
      ({
        fileSystem,
        trackDirectoryResolver,
        container: c,
        packageRoot,
      }: {
        fileSystem: FileSystem;
        trackDirectoryResolver: TrackDirectoryResolver;
        container: AwilixContainer<CliCradle>;
        packageRoot: string;
      }) => {
        return new UIService(fileSystem, trackDirectoryResolver, c, packageRoot);
      }
    ).scoped(),

    // Commands
    uninitCommand: asFunction(({ uninstallService }: { uninstallService: UninstallService }) => {
      return new UninitCommand(uninstallService);
    }).scoped(),

    initCommand: asFunction(
      ({
        gitOps,
        workingDirectory,
        installService,
      }: {
        gitOps: GitOperations;
        workingDirectory: string;
        installService: InstallService;
      }) => {
        return new InitCommand(gitOps, workingDirectory, installService);
      }
    ).scoped(),

    updateCommand: asFunction(
      ({ updateService, uiService }: { updateService: UpdateService; uiService: UIService }) => {
        return new UpdateCommand(updateService, uiService);
      }
    ).scoped(),

    uiCommand: asFunction(({ uiService }: { uiService: UIService }) => {
      return new UICommand(uiService);
    }).scoped(),

    workerCommand: asFunction(
      ({
        workerQueueDb,
        sourceProvider,
        projectsResolver,
      }: {
        workerQueueDb: GlobalDbWorkerQueueDb;
        sourceProvider: DbSourceProvider;
        projectsResolver: ProjectsResolver;
      }) => {
        return new WorkerCommand(workerQueueDb, sourceProvider, projectsResolver);
      }
    ).scoped(),

    claudeConfigCommand: asFunction(
      ({ claudeConfigService }: { claudeConfigService: ClaudeConfigService }) => {
        return new ClaudeConfigCommand(claudeConfigService);
      }
    ).scoped(),

    mcpCommand: asClass(MCPCommand).scoped(),

    setupCommand: asClass(SetupCommand).scoped(),

    uninstallCommand: asFunction(({ uninstallService }: { uninstallService: UninstallService }) => {
      return new UninstallCommand(uninstallService);
    }).scoped(),
  });

  // Self-reference so services (e.g. UIService) can boot sub-systems that need
  // to resolve service tags against this container at runtime.
  container.register({
    container: asValue(container),
  });

  return container;
}

/**
 * Type-safe container with CLI cradle
 */
export type CliContainer = AwilixContainer<CliCradle>;

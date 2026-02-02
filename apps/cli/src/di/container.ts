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

import * as path from "node:path";
import { createContainer, asClass, asFunction, InjectionMode, type AwilixContainer } from "awilix";
import {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
} from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { DbSourceProvider, ProjectsResolver, type ProjectConfig } from "@dev-workflow/tracking";
import { NodeFileSystem, type FileSystem } from "../infrastructure/file-system.js";
import { NodeUserPrompt, type UserPrompt } from "../infrastructure/user-prompt.js";

// Application services
import { UninstallService } from "../application/uninstall.service.js";
import { InstallService } from "../application/install.service.js";
import { UpdateService } from "../application/update.service.js";
import { ArchiveService } from "../application/archive.service.js";
import { BackupConfigService } from "../application/backup.service.js";
import { DatabaseConfigService } from "../application/database.service.js";
import { ClaudeConfigService } from "../application/claude-config.service.js";

// Commands
import { UninitCommand } from "../commands/uninit-command.js";
import { InitCommand } from "../commands/init-command.js";
import { UpdateCommand } from "../commands/update-command.js";
import { ArchiveCommand, UnarchiveCommand, NukeCommand } from "../commands/archive-command.js";
import { UICommand } from "../commands/ui-command.js";
import { WorkerCommand } from "../commands/worker-command.js";
import { BackupCommand } from "../commands/backup-command.js";
import { DatabaseCommand } from "../commands/database-command.js";
import { ClaudeConfigCommand } from "../commands/claude-config-command.js";
import { MCPCommand } from "../commands/mcp-command.js";

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

  // Values (provided at runtime by middleware or computed)
  workingDirectory: string;
  packageRoot: string;
  cliRoot: string;
  cliPath: string;

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
  archiveService: ArchiveService;
  backupService: BackupConfigService;
  databaseService: DatabaseConfigService;
  claudeConfigService: ClaudeConfigService;
  userPrompt: UserPrompt;

  // Commands
  uninitCommand: UninitCommand;
  initCommand: InitCommand;
  updateCommand: UpdateCommand;
  archiveCommand: ArchiveCommand;
  unarchiveCommand: UnarchiveCommand;
  nukeCommand: NukeCommand;
  uiCommand: UICommand;
  workerCommand: WorkerCommand;
  backupCommand: BackupCommand;
  databaseCommand: DatabaseCommand;
  claudeConfigCommand: ClaudeConfigCommand;
  mcpCommand: MCPCommand;
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
    sourceProvider: asClass(DbSourceProvider)
      .singleton()
      .disposer((provider) => provider.closeAll()),

    // Computed values from packageRoot
    cliRoot: asFunction(({ packageRoot }: { packageRoot: string }) => {
      return packageRoot;
    }).singleton(),
    cliPath: asFunction(({ packageRoot }: { packageRoot: string }) => {
      return path.join(packageRoot, "dist/main.js");
    }).singleton(),

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
      ({
        fileSystem,
        workingDirectory,
        trackDirectoryResolver,
      }: {
        fileSystem: FileSystem;
        workingDirectory: string;
        trackDirectoryResolver: TrackDirectoryResolver;
      }) => {
        return new UninstallService(fileSystem, workingDirectory, trackDirectoryResolver);
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

    archiveService: asFunction(
      ({
        fileSystem,
        workingDirectory,
        trackDirectoryResolver,
        sourceProvider,
        gitOps,
        installService,
      }: {
        fileSystem: FileSystem;
        workingDirectory: string;
        trackDirectoryResolver: TrackDirectoryResolver;
        sourceProvider: DbSourceProvider;
        gitOps: GitOperations;
        installService: InstallService;
      }) => {
        return new ArchiveService(
          fileSystem,
          workingDirectory,
          trackDirectoryResolver,
          sourceProvider,
          gitOps,
          installService
        );
      }
    ).scoped(),

    // Services with no constructor dependencies
    backupService: asFunction(() => new BackupConfigService())
      .scoped()
      .disposer((service) => service.close()),

    databaseService: asFunction(() => new DatabaseConfigService())
      .scoped()
      .disposer((service) => service.close()),

    claudeConfigService: asFunction(() => new ClaudeConfigService()).scoped(),

    // Commands
    uninitCommand: asFunction(({ uninstallService }: { uninstallService: UninstallService }) => {
      return new UninitCommand(uninstallService);
    }).scoped(),

    initCommand: asFunction(
      ({
        gitOps,
        workingDirectory,
        installService,
        archiveService,
      }: {
        gitOps: GitOperations;
        workingDirectory: string;
        installService: InstallService;
        archiveService: ArchiveService;
      }) => {
        return new InitCommand(gitOps, workingDirectory, installService, archiveService);
      }
    ).scoped(),

    updateCommand: asFunction(({ updateService }: { updateService: UpdateService }) => {
      return new UpdateCommand(updateService);
    }).scoped(),

    archiveCommand: asFunction(({ archiveService }: { archiveService: ArchiveService }) => {
      return new ArchiveCommand(archiveService);
    }).scoped(),

    unarchiveCommand: asFunction(
      ({
        archiveService,
        gitOps,
        workingDirectory,
      }: {
        archiveService: ArchiveService;
        gitOps: GitOperations;
        workingDirectory: string;
      }) => {
        return new UnarchiveCommand(archiveService, gitOps, workingDirectory);
      }
    ).scoped(),

    nukeCommand: asFunction(
      ({
        archiveService,
        databaseService,
        trackDirectoryResolver,
        userPrompt,
      }: {
        archiveService: ArchiveService;
        databaseService: DatabaseConfigService;
        trackDirectoryResolver: TrackDirectoryResolver;
        userPrompt: UserPrompt;
      }) => {
        return new NukeCommand(archiveService, databaseService, trackDirectoryResolver, userPrompt);
      }
    ).scoped(),

    uiCommand: asFunction(({ cliPath }: { cliPath: string }) => {
      return new UICommand(cliPath);
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

    backupCommand: asFunction(({ backupService }: { backupService: BackupConfigService }) => {
      return new BackupCommand(backupService);
    }).scoped(),

    databaseCommand: asFunction(
      ({ databaseService }: { databaseService: DatabaseConfigService }) => {
        return new DatabaseCommand(databaseService);
      }
    ).scoped(),

    claudeConfigCommand: asFunction(
      ({ claudeConfigService }: { claudeConfigService: ClaudeConfigService }) => {
        return new ClaudeConfigCommand(claudeConfigService);
      }
    ).scoped(),

    mcpCommand: asFunction(({ cliRoot }: { cliRoot: string }) => {
      return new MCPCommand(cliRoot);
    }).scoped(),
  });

  return container;
}

/**
 * Type-safe container with CLI cradle
 */
export type CliContainer = AwilixContainer<CliCradle>;

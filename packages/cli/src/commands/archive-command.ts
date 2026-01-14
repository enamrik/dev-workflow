/**
 * ArchiveCommand - Archive, unarchive, and nuke projects
 *
 * Handles project lifecycle management: archiving (hide but preserve),
 * unarchiving (restore), and nuking (permanent delete).
 * Receives all dependencies via constructor injection.
 */

import { TrackDirectoryResolver, GitOperations, ProjectConfig } from "@dev-workflow/core";
import type { FileSystem } from "../infrastructure/file-system.js";
import { ArchiveService, ArchiveError } from "../application/archive.service.js";
import { DatabaseConfigService } from "../application/database.service.js";

export interface ArchiveCommandDeps {
  fileSystem: FileSystem;
  gitOps: GitOperations;
  workingDirectory: string;
  packageRoot: string;
  trackDirectoryResolver: TrackDirectoryResolver;
  config: ProjectConfig;
}

export interface UnarchiveCommandDeps {
  fileSystem: FileSystem;
  gitOps: GitOperations;
  workingDirectory: string;
  packageRoot: string;
  trackDirectoryResolver: TrackDirectoryResolver;
}

export interface NukeOptions {
  force?: boolean;
}

export class ArchiveCommand {
  constructor(private readonly deps: ArchiveCommandDeps) {}

  /**
   * Archive project (uninit + hide from UI) - preserves all data.
   */
  async execute(): Promise<void> {
    const { fileSystem, workingDirectory, config } = this.deps;
    const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);
    const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver);

    try {
      const project = await archiveService.getProject();
      if (!project) {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nRun: dev-workflow init");
        process.exit(1);
      }

      if (project.isArchived) {
        console.error("❌ Project is already archived.");
        console.error(`   Project: ${project.name}`);
        console.error("\nTo restore, run: dev-workflow unarchive");
        process.exit(1);
      }

      console.log("📦 Archiving project...");
      console.log(`   Project: ${project.name} (${project.id.slice(0, 8)}...)`);

      await archiveService.archive();

      console.log("\n✓ Removed skills");
      console.log("✓ Unregistered MCP server");
      console.log("✓ Marked project as archived");

      console.log("\n✨ Project archived successfully!");
      console.log("\nPreserved:");
      console.log("- All project data (issues, plans, tasks) in ~/.track/");
      console.log("- Project will be hidden from UI until unarchived");
      console.log("\nTo restore, run: dev-workflow unarchive");
    } catch (error) {
      if (error instanceof ArchiveError) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
      console.error("Error during archive:", error);
      process.exit(1);
    }
  }
}

export class UnarchiveCommand {
  constructor(private readonly deps: UnarchiveCommandDeps) {}

  /**
   * Restore archived project (reinstalls Claude integration).
   */
  async execute(): Promise<void> {
    const { fileSystem, gitOps, workingDirectory, packageRoot, trackDirectoryResolver } = this.deps;

    // Check for worktree
    if (gitOps.isWorktree(workingDirectory)) {
      console.error("❌ Cannot run unarchive from a git worktree.");
      console.error("   Run this command from the main repository.");
      process.exit(1);
    }

    const archiveService = new ArchiveService(
      fileSystem,
      workingDirectory,
      trackDirectoryResolver,
      packageRoot
    );

    try {
      const archivedProject = await archiveService.findArchivedProjectByGitHash();

      if (!archivedProject) {
        const project = await archiveService.getProject();
        if (project) {
          console.error("❌ Project is not archived.");
          console.error(`   Project: ${project.name}`);
          process.exit(1);
        } else {
          console.error("❌ No archived project found for this repository.");
          console.error("\nRun: dev-workflow init");
          process.exit(1);
        }
      }

      console.log("📦 Unarchiving project...");
      console.log(`   Project: ${archivedProject.name} (${archivedProject.id.slice(0, 8)}...)`);

      await archiveService.unarchive(archivedProject);

      console.log("\n✓ Marked project as unarchived");
      console.log("✓ Restored local config");
      console.log("✓ Installed skills");
      console.log("✓ Registered MCP server");

      console.log("\n✨ Project unarchived successfully!");
      console.log("\nYour issues, plans, and tasks are ready to use.");
      console.log("Restart Claude Code to pick up the new configuration.");
    } catch (error) {
      if (error instanceof ArchiveError) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
      console.error("Error during unarchive:", error);
      process.exit(1);
    }
  }
}

export interface NukeCommandDeps {
  fileSystem: FileSystem;
  workingDirectory: string;
  trackDirectoryResolver: TrackDirectoryResolver;
  config: ProjectConfig;
  databaseConnectionString: string;
}

export class NukeCommand {
  constructor(private readonly deps: NukeCommandDeps) {}

  /**
   * PERMANENTLY DELETE all project data.
   */
  async execute(options: NukeOptions = {}): Promise<void> {
    const { fileSystem, workingDirectory, config } = this.deps;

    const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

    // Check if using remote database - block unless --force is used
    const dbService = new DatabaseConfigService();
    try {
      const isRemote = await dbService.isRemote();
      if (isRemote) {
        const status = await dbService.getStatus();
        console.error("❌ Cannot nuke when using a remote database.\n");
        console.error(`   Current database: ${status.provider}`);
        console.error(
          `   Connection: ${DatabaseConfigService.maskPassword(status.connectionString)}`
        );
        console.error("\n   Remote databases contain shared team data that cannot be recovered.");
        console.error(
          "   This protection prevents accidental destruction of collaborative work.\n"
        );

        if (!options.force) {
          console.error("   If you really want to remove this project's LOCAL data only,");
          console.error("   use: dev-workflow nuke --force\n");
          console.error("   Note: --force will only remove local files and MCP registration.");
          console.error("   Remote database data will NOT be affected.");
          process.exit(1);
        }

        console.log("⚠️  --force flag detected. Proceeding with LOCAL cleanup only.");
        console.log("   Remote database data will NOT be deleted.\n");
      }
    } finally {
      dbService.close();
    }

    const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver);

    try {
      const project = await archiveService.getProject();
      if (!project) {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nNothing to delete.");
        process.exit(1);
      }

      const trackDir = resolver.getTrackDirectory();

      console.log("⚠️  WARNING: This will PERMANENTLY DELETE all project data!\n");
      console.log("   Project: " + project.name);
      console.log("   Track directory: " + trackDir);
      console.log("\n   This action CANNOT be undone.\n");

      // Interactive confirmation - user must type project name
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(`Type the project name to confirm deletion (${project.name}): `, (answer) => {
          rl.close();
          resolve(answer);
        });
      });

      if (answer !== project.name) {
        console.error("\n❌ Project name does not match. Aborting.");
        process.exit(1);
      }

      console.log("\n💣 Nuking project...");

      await archiveService.nuke(project);

      console.log("\n✓ Removed skills");
      console.log("✓ Unregistered MCP server");
      console.log("✓ Deleted all project data from database");
      console.log("✓ Removed track directory");

      console.log("\n✨ Project nuked successfully!");
      console.log("\nAll project data has been permanently deleted.");
    } catch (error) {
      if (error instanceof ArchiveError) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
      console.error("Error during nuke:", error);
      process.exit(1);
    }
  }
}

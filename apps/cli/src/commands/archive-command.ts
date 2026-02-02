/**
 * ArchiveCommand - Archive, unarchive, and nuke projects
 *
 * Handles project lifecycle management: archiving (hide but preserve),
 * unarchiving (restore), and nuking (permanent delete).
 * Receives all dependencies via constructor injection.
 */

import { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import { ArchiveService, ArchiveError } from "../application/archive.service.js";
import { DatabaseConfigService } from "../application/database.service.js";
import type { UserPrompt } from "../infrastructure/user-prompt.js";

export interface NukeOptions {
  force?: boolean;
}

export class ArchiveCommand {
  constructor(private readonly archiveService: ArchiveService) {}

  /**
   * Archive project (uninit + hide from UI) - preserves all data.
   */
  async execute(): Promise<void> {
    try {
      const project = await this.archiveService.getProject();
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

      await this.archiveService.archive();

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
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly gitOps: GitOperations,
    private readonly workingDirectory: string
  ) {}

  /**
   * Restore archived project (reinstalls Claude integration).
   */
  async execute(): Promise<void> {
    // Check for worktree
    if (this.gitOps.isWorktree(this.workingDirectory)) {
      console.error("❌ Cannot run unarchive from a git worktree.");
      console.error("   Run this command from the main repository.");
      process.exit(1);
    }

    try {
      const archivedProject = await this.archiveService.findArchivedProjectByGitHash();

      if (!archivedProject) {
        const project = await this.archiveService.getProject();
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

      await this.archiveService.unarchive(archivedProject);

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

export class NukeCommand {
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly databaseService: DatabaseConfigService,
    private readonly trackDirectoryResolver: TrackDirectoryResolver,
    private readonly userPrompt: UserPrompt
  ) {}

  /**
   * PERMANENTLY DELETE all project data.
   */
  async execute(options: NukeOptions = {}): Promise<void> {
    // Check if using remote database - block unless --force is used
    const isRemote = await this.databaseService.isRemote();
    if (isRemote) {
      const status = await this.databaseService.getStatus();
      console.error("❌ Cannot nuke when using a remote database.\n");
      console.error(`   Current database: ${status.provider}`);
      console.error(
        `   Connection: ${DatabaseConfigService.maskPassword(status.connectionString)}`
      );
      console.error("\n   Remote databases contain shared team data that cannot be recovered.");
      console.error("   This protection prevents accidental destruction of collaborative work.\n");

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

    try {
      const project = await this.archiveService.getProject();
      if (!project) {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nNothing to delete.");
        process.exit(1);
      }

      const trackDir = this.trackDirectoryResolver.getTrackDirectory();

      console.log("⚠️  WARNING: This will PERMANENTLY DELETE all project data!\n");
      console.log("   Project: " + project.name);
      console.log("   Track directory: " + trackDir);
      console.log("\n   This action CANNOT be undone.\n");

      // Interactive confirmation - user must type project name
      const answer = await this.userPrompt.ask(
        `Type the project name to confirm deletion (${project.name}): `
      );

      if (answer !== project.name) {
        console.error("\n❌ Project name does not match. Aborting.");
        process.exit(1);
      }

      console.log("\n💣 Nuking project...");

      await this.archiveService.nuke(project);

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

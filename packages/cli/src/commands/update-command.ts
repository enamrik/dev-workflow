/**
 * UpdateCommand - Update dev-workflow to latest version
 *
 * Updates skills, templates, migrations, and MCP server registration.
 * Receives all dependencies via constructor injection.
 */

import { TrackDirectoryResolver } from "@dev-workflow/core";
import type { FileSystem } from "../infrastructure/file-system.js";
import { UpdateService } from "../application/update.service.js";

export interface UpdateCommandDeps {
  fileSystem: FileSystem;
  workingDirectory: string;
  packageRoot: string;
  trackDirectoryResolver: TrackDirectoryResolver;
  databaseConnectionString: string;
}

export class UpdateCommand {
  constructor(private readonly deps: UpdateCommandDeps) {}

  /**
   * Update dev-workflow installation.
   */
  async execute(): Promise<void> {
    const {
      fileSystem,
      workingDirectory,
      packageRoot,
      trackDirectoryResolver,
      databaseConnectionString,
    } = this.deps;

    const updater = new UpdateService(
      fileSystem,
      workingDirectory,
      packageRoot,
      trackDirectoryResolver,
      databaseConnectionString
    );

    try {
      console.log("🔄 Updating dev-workflow...");

      // Migrate track directory from old naming to new naming (must be first)
      const dirMigration = await updater.migrateTrackDirectory();
      if (dirMigration.migrated) {
        console.log(`✓ Migrated track directory:`);
        console.log(`  ${dirMigration.oldPath} → ${dirMigration.newPath}`);
      }

      await updater.updateSkills();
      console.log("✓ Updated skills");

      await updater.updateTemplates();
      console.log("✓ Updated local templates");

      await updater.updateGlobalTemplates();
      console.log("✓ Updated global default templates");

      await updater.runMigrations();
      console.log("✓ Ran database migrations");

      // Register/update project in database
      const project = await updater.registerProject();
      console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

      // Migrate existing issues from old path-based projectId to new UUID
      const migrationResult = await updater.migrateIssues();
      if (migrationResult.migrated > 0) {
        console.log(
          `✓ Migrated ${migrationResult.migrated} issues from ${migrationResult.oldProjectId} to ${project.id.slice(0, 8)}...`
        );
      }

      await updater.updateMCPServer();
      console.log("✓ Updated MCP server registration");

      const permResult = await updater.configureClaudePermissions();
      if (permResult.configured) {
        console.log("✓ Updated Claude permissions");
      }

      await updater.restartUIDaemonIfRunning();

      console.log("\n✨ dev-workflow updated successfully!");
      console.log("\nChanges:");
      console.log("- Skills updated to latest version");
      console.log("- New templates added (existing customizations preserved)");
      console.log("- MCP server registration refreshed");
      console.log("- Claude permissions updated");
      console.log("- Database schema updated");
    } catch (error) {
      console.error("Error during update:", error);
      process.exit(1);
    }
  }
}

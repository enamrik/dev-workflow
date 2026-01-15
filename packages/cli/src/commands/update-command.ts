/**
 * UpdateCommand - Update dev-workflow to latest version
 *
 * Updates skills, templates, migrations, and MCP server registration.
 * Receives all dependencies via constructor injection.
 */

import { UpdateService } from "../application/update.service.js";

export class UpdateCommand {
  constructor(private readonly updateService: UpdateService) {}

  /**
   * Update dev-workflow installation.
   */
  async execute(): Promise<void> {
    try {
      console.log("🔄 Updating dev-workflow...");

      // Migrate track directory from old naming to new naming (must be first)
      const dirMigration = await this.updateService.migrateTrackDirectory();
      if (dirMigration.migrated) {
        console.log(`✓ Migrated track directory:`);
        console.log(`  ${dirMigration.oldPath} → ${dirMigration.newPath}`);
      }

      await this.updateService.updateSkills();
      console.log("✓ Updated skills");

      await this.updateService.updateTemplates();
      console.log("✓ Updated local templates");

      await this.updateService.updateGlobalTemplates();
      console.log("✓ Updated global default templates");

      await this.updateService.runMigrations();
      console.log("✓ Ran database migrations");

      // Register/update project in database
      const project = await this.updateService.registerProject();
      console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

      // Migrate existing issues from old path-based projectId to new UUID
      const migrationResult = await this.updateService.migrateIssues();
      if (migrationResult.migrated > 0) {
        console.log(
          `✓ Migrated ${migrationResult.migrated} issues from ${migrationResult.oldProjectId} to ${project.id.slice(0, 8)}...`
        );
      }

      await this.updateService.updateMCPServer();
      console.log("✓ Updated MCP server registration");

      const permResult = await this.updateService.configureClaudePermissions();
      if (permResult.configured) {
        console.log("✓ Updated Claude permissions");
      }

      await this.updateService.restartUIDaemonIfRunning();

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

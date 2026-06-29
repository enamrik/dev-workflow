/**
 * UpdateCommand - Two-phase `dfl update`.
 *
 * PHASE 1 (ReleaseInstaller): fetch + apply the released artifact — install the
 *   latest GitHub release (or --version <v>) into ~/.dfl/install and rewrite the
 *   launcher. No npm. No-op when already on the target version.
 * PHASE 2 (UpdateService): reconcile against the freshly-applied bundle — skills,
 *   templates, migrations, MCP registration. Runs only AFTER phase 1.
 *
 * Receives all dependencies via constructor injection.
 */

import { UpdateService } from "../application/update.service.js";
import { UIService } from "../application/ui.service.js";
import { ReleaseInstaller } from "../application/release-installer.js";

/** Options accepted by `dfl update`. */
export interface UpdateExecuteOptions {
  /** Install a specific release version instead of the latest. */
  version?: string;
  /** List recent releases and exit (read-only; no install/reconcile). */
  list?: boolean;
}

export class UpdateCommand {
  constructor(
    private readonly updateService: UpdateService,
    private readonly uiService: UIService,
    private readonly releaseInstaller: ReleaseInstaller
  ) {}

  /**
   * Update dev-workflow installation.
   */
  async execute(options: UpdateExecuteOptions = {}): Promise<void> {
    try {
      if (options.list) {
        await this.listReleases();
        return;
      }

      // ----- Phase 1: fetch + apply the released artifact -----
      const targetLabel = options.version ? `version ${options.version}` : "the latest release";
      console.log(`🔄 Updating dev-workflow to ${targetLabel}...`);
      const result = await this.releaseInstaller.installRelease({ version: options.version });
      if (!result.changed) {
        // Already on the target version — full no-op (phase 2 already ran when
        // this version was first installed). Nothing to download or reconcile.
        console.log(`✓ Already on version ${result.version}. Nothing to do.`);
        return;
      }
      console.log(`✓ Installed dev-workflow ${result.version}`);

      // ----- Phase 2: reconcile against the freshly-applied bundle -----
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

      await this.uiService.restart();

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

  /** Print recent releases (newest first), the read-only `--list` path. */
  private async listReleases(): Promise<void> {
    const releases = await this.releaseInstaller.listReleases();
    if (releases.length === 0) {
      console.log("No releases found.");
      return;
    }
    console.log("Recent dev-workflow releases (newest first):");
    for (const release of releases) {
      const date = release.publishedAt ? release.publishedAt.slice(0, 10) : "unknown date";
      console.log(`  ${release.version}  (${date})`);
    }
  }
}

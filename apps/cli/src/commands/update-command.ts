/**
 * UpdateCommand - Two-phase `dfl update`.
 *
 * PHASE 1 (pluggable source): produce the `~/.dfl/install` bundle and rewrite the
 *   launcher. Two sources, selected by options:
 *     - default / --version <v>: ReleaseInstaller — fetch + apply a GitHub
 *       release artifact (no npm; no-op when already on the target version).
 *     - --from <path>: SourceBuildInstaller — build the bundle from a local
 *       dev-workflow source tree/worktree (`make dogfood` as a command).
 * PHASE 2 (UpdateService): reconcile against the freshly-applied bundle — skills,
 *   templates, migrations, MCP registration. Shared by both sources; runs only
 *   AFTER phase 1.
 *
 * Receives all dependencies via constructor injection.
 */

import { UpdateService } from "../application/update.service.js";
import { UIService } from "../application/ui.service.js";
import { ReleaseInstaller } from "../application/release-installer.js";
import { SourceBuildInstaller } from "../application/source-build-installer.js";

/** Options accepted by `dfl update`. */
export interface UpdateExecuteOptions {
  /** Install a specific release version instead of the latest. */
  version?: string;
  /** List recent releases and exit (read-only; no install/reconcile). */
  list?: boolean;
  /** Build + install from a local dev-workflow source tree/worktree (dogfood). */
  from?: string;
}

export class UpdateCommand {
  constructor(
    private readonly updateService: UpdateService,
    private readonly uiService: UIService,
    private readonly releaseInstaller: ReleaseInstaller,
    private readonly sourceBuildInstaller: SourceBuildInstaller
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

      // ----- Phase 1: produce the ~/.dfl/install bundle -----
      // Source is selected here (the only thing that varies); phase 2 below is
      // shared. --from builds the local tree; otherwise fetch a release artifact.
      const fromSource = options.from !== undefined;
      const targetLabel = fromSource
        ? `local build from ${SourceBuildInstaller.resolveSourcePath(options.from)}`
        : options.version
          ? `version ${options.version}`
          : "the latest release";
      console.log(`🔄 Updating dev-workflow to ${targetLabel}...`);
      const result = fromSource
        ? await this.sourceBuildInstaller.installFromSource({ from: options.from })
        : await this.releaseInstaller.installRelease({ version: options.version });
      if (result.changed) {
        console.log(`✓ Installed dev-workflow ${result.version}`);
      } else {
        // The artifact install is the no-op here (already on target — nothing to
        // download). Phase 2 still runs: reconciliation is idempotent and heals
        // global skills / per-project MCP registration / migrations that can be
        // missing even when the bundle version already matches.
        console.log(`✓ Already on version ${result.version} — no download needed. Reconciling...`);
      }

      // ----- Phase 2: reconcile against the applied bundle -----
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

/**
 * InitCommand - Initialize dev-workflow in a repository
 *
 * Handles fresh installation and repair/re-init flows.
 * Receives all dependencies via constructor injection.
 */

import * as fs from "node:fs";
import {
  TrackDirectoryResolver,
  getGlobalDatabasePath,
} from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import { writeConfig, resolveConfig, type Project } from "@dev-workflow/tracking";
import { InstallService } from "../application/install.service.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InitOptions {}

export class InitCommand {
  constructor(
    private readonly gitOps: GitOperations,
    private readonly workingDirectory: string,
    private readonly installService: InstallService
  ) {}

  /**
   * Initialize dev-workflow in the current repository.
   */
  async execute(_options: InitOptions = {}): Promise<void> {
    // Check for git repository and at least one commit
    if (!this.gitOps.isGitRepository(this.workingDirectory)) {
      console.error("❌ Not a git repository. dev-workflow requires git.");
      process.exit(1);
    }

    if (!this.gitOps.hasCommit(this.workingDirectory)) {
      console.error("❌ No commits found. dev-workflow requires at least one commit.");
      console.error('   Run: git commit --allow-empty -m "Initial commit"');
      process.exit(1);
    }

    // Check if running from a worktree
    if (this.gitOps.isWorktree(this.workingDirectory)) {
      console.error("❌ Cannot run init from a git worktree.");
      console.error("   Run this command from the main repository, not a worktree.");
      console.error("\n   To find your main repo:");
      console.error("   git worktree list | head -1 | cut -d' ' -f1");
      process.exit(1);
    }

    // Create resolver to get global track directory path
    const resolver = new TrackDirectoryResolver(this.workingDirectory);
    const gitRoot = this.gitOps.findGitRoot(this.workingDirectory);
    const slug = resolver.getProjectId();

    // Always use global database
    const databaseConnectionString = `sqlite://${getGlobalDatabasePath()}`;

    // Check if this project was previously initialized
    const existingSlug = this.gitOps.readSlugFromGitConfig(gitRoot);

    if (existingSlug) {
      try {
        await resolveConfig(existingSlug);
      } catch {
        // Config doesn't exist or is invalid - will be recreated
      }
    }

    // Check if this project already exists in the database
    const existingProject = await this.installService.findExistingProject(databaseConnectionString);
    const trackDir = resolver.getTrackDirectory();
    const trackDirExists = fs.existsSync(trackDir);

    // Determine mode: fresh install or repair/re-init
    if (existingProject) {
      await this.handleRepairMode(
        existingProject,
        gitRoot,
        slug,
        databaseConnectionString,
        trackDirExists,
        trackDir
      );
      return;
    }

    // Fresh install mode
    await this.handleFreshInstall(gitRoot, slug, databaseConnectionString, trackDir);
  }

  private async handleRepairMode(
    existingProject: Project,
    gitRoot: string,
    slug: string,
    databaseConnectionString: string,
    trackDirExists: boolean,
    trackDir: string
  ): Promise<void> {
    console.log("🔧 Re-initializing dev-workflow...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      this.installService.setProject(existingProject);
      await this.installService.initializeDatabase(databaseConnectionString);

      const seedResult = await this.installService.seedDefaultTypes(databaseConnectionString);
      if (seedResult.seeded > 0) {
        console.log(`✓ Seeded ${seedResult.seeded} default types`);
      }

      this.gitOps.writeSlugToGitConfig(gitRoot, slug);
      console.log(`✓ Updated project slug in .git/config`);

      await writeConfig({
        slug,
        name: existingProject.name,
        database: databaseConnectionString,
        gitRoot,
        projectId: existingProject.id,
      });
      console.log(`✓ Updated config.json`);

      if (!trackDirExists) {
        await this.installService.createTrackDirectory();
        console.log(`✓ Recreated ${trackDir}`);
      }

      await this.installService.installGlobalTemplates();
      console.log("✓ Updated global default templates");

      const worktreeResult = await this.installService.repairWorktrees();
      if (worktreeResult.repaired) {
        console.log("✓ Repaired git worktrees");
      } else {
        console.log(`⚠ Worktree repair: ${worktreeResult.output}`);
      }

      await this.installService.installSkills();
      console.log("✓ Updated skills");

      await this.installService.registerMCPServer();
      console.log("✓ Re-registered MCP server with new paths");

      const permResult = await this.installService.configureClaudePermissions();
      if (permResult.configured) {
        console.log("✓ Updated Claude permissions");
      }

      console.log("\n✨ dev-workflow re-initialized successfully!");
      console.log("\nYour issues, plans, and tasks are preserved.");
      console.log("Restart Claude Code to pick up the new configuration.");
    } catch (error) {
      console.error("Error during repair:", error);
      process.exit(1);
    }
  }

  private async handleFreshInstall(
    gitRoot: string,
    slug: string,
    databaseConnectionString: string,
    trackDir: string
  ): Promise<void> {
    try {
      console.log("🚀 Initializing dev-workflow...");
      console.log(`   Database: ${getGlobalDatabasePath()}`);
      console.log();

      await this.installService.initializeDatabase(databaseConnectionString);
      console.log("✓ Initialized database");

      const seedResult = await this.installService.seedDefaultTypes(databaseConnectionString);
      console.log(`✓ Seeded ${seedResult.seeded} default types`);

      const project = await this.installService.registerProject(databaseConnectionString);
      console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

      this.gitOps.writeSlugToGitConfig(gitRoot, slug);
      console.log(`✓ Wrote project slug to .git/config (${slug})`);

      await writeConfig({
        slug,
        name: project.name,
        database: databaseConnectionString,
        gitRoot,
        projectId: project.id,
      });
      console.log(`✓ Created config.json`);

      await this.installService.createTrackDirectory();
      console.log(`✓ Created ${trackDir}`);

      await this.installService.installGlobalTemplates();
      console.log("✓ Installed global default templates");

      await this.installService.installSkills();
      console.log("✓ Installed skills");

      await this.installService.registerMCPServer();
      console.log("✓ Registered MCP server");

      const permResult = await this.installService.configureClaudePermissions();
      if (permResult.configured) {
        console.log("✓ Configured Claude permissions for worktrees");
        for (const perm of permResult.permissions) {
          console.log(`  - ${perm}`);
        }
      } else {
        console.log("⚠ Could not configure Claude permissions (claude CLI not available)");
        console.log("  You can add them manually with:");
        for (const perm of permResult.permissions) {
          console.log(`    claude config add allowedTools "${perm}"`);
        }
      }

      console.log("\n✨ dev-workflow initialized successfully!");
      console.log("\nNext steps:");
      console.log("1. Restart Claude Code to discover skills");
      console.log('2. Say: "Create an issue for adding user authentication"');
      console.log("3. A plan with tasks will be auto-generated");
    } catch (error) {
      console.error("Error during initialization:", error);
      process.exit(1);
    }
  }
}

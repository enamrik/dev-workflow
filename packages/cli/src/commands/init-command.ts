/**
 * InitCommand - Initialize dev-workflow in a repository
 *
 * Handles fresh installation, repair/re-init, and auto-unarchive flows.
 * Receives all dependencies via constructor injection.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  TrackDirectoryResolver,
  GitOperations,
  writeConfig,
  resolveConfig,
  getGlobalDatabasePath,
  type Project,
} from "@dev-workflow/core";
import type { FileSystem } from "../infrastructure/file-system.js";
import { InstallService } from "../application/install.service.js";
import { ArchiveService } from "../application/archive.service.js";
import { DatabaseConfigService } from "../application/database.service.js";

export interface InitOptions {
  local?: boolean;
  url?: string;
}

export class InitCommand {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly gitOps: GitOperations,
    private readonly workingDirectory: string,
    private readonly packageRoot: string
  ) {}

  /**
   * Initialize dev-workflow in the current repository.
   */
  async execute(options: InitOptions = {}): Promise<void> {
    // Check for git repository and at least one commit
    if (!this.hasGitCommit()) {
      // Check if it's a git repo at all
      try {
        execSync("git rev-parse --git-dir", {
          cwd: this.workingDirectory,
          stdio: ["pipe", "pipe", "pipe"],
        });
        // It's a git repo but no commits
        console.error("❌ No commits found. dev-workflow requires at least one commit.");
        console.error('   Run: git commit --allow-empty -m "Initial commit"');
        process.exit(1);
      } catch {
        // Not a git repo
        console.error("❌ Not a git repository. dev-workflow requires git.");
        process.exit(1);
      }
    }

    // Check if running from a worktree
    if (this.gitOps.isWorktree(this.workingDirectory)) {
      console.error("❌ Cannot run init from a git worktree.");
      console.error("   Run this command from the main repository, not a worktree.");
      console.error("\n   To find your main repo:");
      console.error("   git worktree list | head -1 | cut -d' ' -f1");
      process.exit(1);
    }

    // Validate mutually exclusive options
    if (options.local && options.url) {
      console.error("❌ Cannot use --local and --url together.");
      console.error("   Use --local for local SQLite database.");
      console.error("   Use --url for remote PostgreSQL database.");
      process.exit(1);
    }

    // Validate --url format
    if (options.url) {
      if (!options.url.startsWith("postgresql://") && !options.url.startsWith("postgres://")) {
        console.error("❌ Invalid connection string format.");
        console.error("   Expected: postgresql://user:password@host/database");
        process.exit(1);
      }
    }

    // Create resolver to get global track directory path
    const resolver = new TrackDirectoryResolver(this.workingDirectory);
    const gitRoot = this.gitOps.findGitRoot(this.workingDirectory);
    const slug = resolver.getProjectId();

    // Determine database connection string based on options
    let databaseConnectionString = this.getDatabaseConnectionString(options, gitRoot);

    // Check if this project was previously initialized
    const existingSlug = this.gitOps.readSlugFromGitConfig(gitRoot);
    let existingConfig: Awaited<ReturnType<typeof resolveConfig>> | null = null;

    if (existingSlug) {
      try {
        existingConfig = await resolveConfig(existingSlug);
        if (!options.url && !options.local) {
          databaseConnectionString = existingConfig.database;
        }
      } catch {
        // Config doesn't exist or is invalid - will be recreated
      }
    }

    const installer = new InstallService(
      this.fileSystem,
      this.workingDirectory,
      this.packageRoot,
      resolver,
      databaseConnectionString
    );

    // Check if this project already exists in the database
    const existingProject = await installer.findExistingProject();
    const trackDir = resolver.getTrackDirectory();
    const trackDirExists = fs.existsSync(trackDir);

    // Check if project is archived - auto-unarchive if so
    if (existingProject && existingProject.isArchived) {
      await this.handleArchivedProject(existingProject, resolver);
      return;
    }

    // Determine mode: fresh install or repair/re-init
    if (existingProject) {
      await this.handleRepairMode(
        existingProject,
        installer,
        resolver,
        gitRoot,
        slug,
        databaseConnectionString,
        trackDirExists,
        trackDir
      );
      return;
    }

    // Fresh install mode
    await this.handleFreshInstall(
      installer,
      resolver,
      gitRoot,
      slug,
      databaseConnectionString,
      options,
      trackDir
    );
  }

  private hasGitCommit(): boolean {
    try {
      execSync("git rev-parse HEAD", {
        cwd: this.workingDirectory,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  private getDatabaseConnectionString(options: InitOptions, gitRoot: string): string {
    if (options.url) {
      return options.url;
    } else if (options.local) {
      const localDbPath = path.resolve(gitRoot, ".track/workflow.db");
      return `sqlite://${localDbPath}`;
    } else {
      return `sqlite://${getGlobalDatabasePath()}`;
    }
  }

  private async handleArchivedProject(
    existingProject: Project,
    resolver: TrackDirectoryResolver
  ): Promise<void> {
    console.log("📦 Detected archived project, restoring...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      const archiveService = new ArchiveService(
        this.fileSystem,
        this.workingDirectory,
        resolver,
        this.packageRoot
      );
      await archiveService.unarchive(existingProject);

      console.log("✓ Marked project as unarchived");
      console.log("✓ Restored local config");
      console.log("✓ Installed skills");
      console.log("✓ Registered MCP server");

      console.log("\n✨ Project restored successfully!");
      console.log("\nYour issues, plans, and tasks are ready to use.");
      console.log("Restart Claude Code to pick up the new configuration.");
    } catch (error) {
      console.error("Error during unarchive:", error);
      process.exit(1);
    }
  }

  private async handleRepairMode(
    existingProject: Project,
    installer: InstallService,
    _resolver: TrackDirectoryResolver,
    gitRoot: string,
    slug: string,
    databaseConnectionString: string,
    trackDirExists: boolean,
    trackDir: string
  ): Promise<void> {
    console.log("🔧 Re-initializing dev-workflow...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      installer.setProject(existingProject);
      await installer.initializeDatabase();

      const seedResult = await installer.seedDefaultTypes();
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
        await installer.createTrackDirectory();
        console.log(`✓ Recreated ${trackDir}`);
      }

      await installer.installGlobalTemplates();
      console.log("✓ Updated global default templates");

      const worktreeResult = await installer.repairWorktrees();
      if (worktreeResult.repaired) {
        console.log("✓ Repaired git worktrees");
      } else {
        console.log(`⚠ Worktree repair: ${worktreeResult.output}`);
      }

      await installer.installSkills();
      console.log("✓ Updated skills");

      await installer.registerMCPServer();
      console.log("✓ Re-registered MCP server with new paths");

      const permResult = await installer.configureClaudePermissions();
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
    installer: InstallService,
    _resolver: TrackDirectoryResolver,
    gitRoot: string,
    slug: string,
    databaseConnectionString: string,
    options: InitOptions,
    trackDir: string
  ): Promise<void> {
    try {
      console.log("🚀 Initializing dev-workflow...");
      if (options.local) {
        console.log("   Mode: local database (./.track/workflow.db)");
      } else if (options.url) {
        console.log(
          `   Mode: remote database (${DatabaseConfigService.maskPassword(options.url)})`
        );
      } else {
        console.log(`   Mode: global database (${getGlobalDatabasePath()})`);
      }
      console.log();

      await installer.initializeDatabase();
      console.log("✓ Initialized database");

      const seedResult = await installer.seedDefaultTypes();
      console.log(`✓ Seeded ${seedResult.seeded} default types`);

      const project = await installer.registerProject();
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

      await installer.createTrackDirectory();
      console.log(`✓ Created ${trackDir}`);

      await installer.installGlobalTemplates();
      console.log("✓ Installed global default templates");

      await installer.installSkills();
      console.log("✓ Installed skills");

      await installer.registerMCPServer();
      console.log("✓ Registered MCP server");

      const permResult = await installer.configureClaudePermissions();
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

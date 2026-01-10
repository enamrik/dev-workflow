#!/usr/bin/env node

import { Command } from "commander";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import { InstallService } from "./application/install.service.js";
import { UpdateService } from "./application/update.service.js";
import { UninstallService } from "./application/uninstall.service.js";
import { ArchiveService, ArchiveError } from "./application/archive.service.js";
import { UIService } from "./application/ui.service.js";
import { BackupConfigService } from "./application/backup.service.js";
import { DatabaseConfigService, TRACK_DATABASE_URL_ENV } from "./application/database.service.js";
import { ClaudeWorkerService } from "./application/claude-worker.service.js";
import { ClaudeConfigService } from "./application/claude-config.service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";
import {
  TrackDirectoryResolver,
  createTrackDirectoryResolver,
  DataSourceFactory,
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  getGlobalDatabasePath,
  isWorktree,
  writeSlugToGitConfig,
  writeConfig,
  findGitRoot,
  readSlugFromGitConfig,
  resolveConfig,
  resolveConfigFromGit,
  ProjectConfigError,
} from "@dev-workflow/core";

/**
 * Check if the git repository has at least one commit.
 * dev-workflow requires a commit to compute a stable project ID.
 */
function hasGitCommit(cwd: string): boolean {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function getPackageRoot(): string {
  // In development: packages/cli/dist -> packages/cli
  // In production: node_modules/@dev-workflow/cli/dist -> node_modules/@dev-workflow/cli
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = path.dirname(currentFile);
  return path.dirname(distDir); // Go up from dist/ to package root
}

interface InitOptions {
  local?: boolean;
  url?: string;
}

async function runInit(options: InitOptions = {}): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();
  const packageRoot = getPackageRoot();

  // Check for git repository and at least one commit
  if (!hasGitCommit(workingDirectory)) {
    // Check if it's a git repo at all
    try {
      execSync("git rev-parse --git-dir", {
        cwd: workingDirectory,
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
  if (isWorktree(workingDirectory)) {
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
  const resolver = createTrackDirectoryResolver(workingDirectory);
  const gitRoot = findGitRoot(workingDirectory);
  const slug = resolver.getProjectId(); // e.g., "dev-workflow-b9bccf"

  // Determine database connection string based on options
  let databaseConnectionString: string;
  if (options.url) {
    databaseConnectionString = options.url;
  } else if (options.local) {
    databaseConnectionString = "file:./.track/workflow.db";
  } else {
    // Default: global SQLite database
    databaseConnectionString = "file:///~/.track/workflow.db";
  }

  // Check if this project was previously initialized (slug exists in .git/config)
  const existingSlug = readSlugFromGitConfig(gitRoot);
  let existingConfig: Awaited<ReturnType<typeof resolveConfig>> | null = null;

  if (existingSlug) {
    try {
      existingConfig = await resolveConfig(existingSlug);
      // If options change the database, use the new one
      // Otherwise preserve the existing configuration
      if (!options.url && !options.local) {
        databaseConnectionString = existingConfig.database;
      }
    } catch {
      // Config doesn't exist or is invalid - will be recreated
    }
  }

  const installer = new InstallService(
    fileSystem,
    workingDirectory,
    packageRoot,
    resolver,
    databaseConnectionString
  );

  // Check if this project already exists in the database (by gitRootHash)
  const existingProject = await installer.findExistingProject();
  const trackDir = resolver.getTrackDirectory();
  const trackDirExists = fs.existsSync(trackDir);

  // Check if project is archived - auto-unarchive if so
  if (existingProject && existingProject.isArchived) {
    console.log("📦 Detected archived project, restoring...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      const archiveService = new ArchiveService(
        fileSystem,
        workingDirectory,
        resolver,
        packageRoot
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
    return;
  }

  // Determine mode: fresh install or repair/re-init
  if (existingProject) {
    // Repair mode: project exists - run repair to ensure everything is up to date
    // This makes `init` idempotent and safe to run multiple times
    console.log("🔧 Re-initializing dev-workflow...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      // Use existing project
      installer.setProject(existingProject);

      // Ensure database is up to date
      await installer.initializeDatabase();

      // Update slug in .git/config (in case repo moved)
      writeSlugToGitConfig(gitRoot, slug);
      console.log(`✓ Updated project slug in .git/config`);

      // Update config.json with current gitRoot (handles repo move scenario)
      await writeConfig(slug, {
        database: databaseConnectionString,
        gitRoot,
        projectId: existingProject.id,
      });
      console.log(`✓ Updated config.json`);

      // Ensure track directory exists (includes templates and labels)
      if (!trackDirExists) {
        await installer.createTrackDirectory();
        console.log(`✓ Recreated ${trackDir}`);
      }

      // Ensure global templates are installed (always update to latest)
      await installer.installGlobalTemplates();
      console.log("✓ Updated global default templates");

      // Repair git worktrees
      const worktreeResult = await installer.repairWorktrees();
      if (worktreeResult.repaired) {
        console.log("✓ Repaired git worktrees");
      } else {
        console.log(`⚠ Worktree repair: ${worktreeResult.output}`);
      }

      // Update skills (in case they're outdated)
      await installer.installSkills();
      console.log("✓ Updated skills");

      // Re-register MCP server with new paths
      await installer.registerMCPServer();
      console.log("✓ Re-registered MCP server with new paths");

      // Update Claude permissions
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
    return;
  }

  // Fresh install mode
  try {
    console.log("🚀 Initializing dev-workflow...");
    if (options.local) {
      console.log("   Mode: local database (./.track/workflow.db)");
    } else if (options.url) {
      console.log(`   Mode: remote database (${DatabaseConfigService.maskPassword(options.url)})`);
    } else {
      console.log("   Mode: global database (~/.track/workflow.db)");
    }
    console.log();

    // Initialize database first (needed for project registration)
    await installer.initializeDatabase();
    console.log("✓ Initialized database");

    // Register project in database (uses git initial commit hash as stable ID)
    const project = await installer.registerProject();
    console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

    // Write slug to .git/config for future lookups
    writeSlugToGitConfig(gitRoot, slug);
    console.log(`✓ Wrote project slug to .git/config (${slug})`);

    // Write config.json to ~/.track/<slug>/
    await writeConfig(slug, {
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

async function runUpdate(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();
  const packageRoot = getPackageRoot();

  // Resolve config from .git/config → ~/.track/<slug>/config.json
  let config;
  try {
    config = await resolveConfigFromGit(workingDirectory);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      if (error.code === "NOT_GIT_REPO") {
        console.error("❌ Not a git repository. dev-workflow requires git.");
      } else if (error.code === "SLUG_NOT_FOUND" || error.code === "CONFIG_NOT_FOUND") {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nRun: dev-workflow init");
      } else if (error.code === "WORKTREE_DETECTED") {
        console.error("❌ Cannot run update from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  const updater = new UpdateService(fileSystem, workingDirectory, packageRoot, resolver);

  try {
    // Config exists, so project is initialized - proceed with update

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

    // Register/update project in database (uses git initial commit hash as stable ID)
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

async function runUninit(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();

  // Resolve config from .git/config → ~/.track/<slug>/config.json
  let config;
  try {
    config = await resolveConfigFromGit(workingDirectory);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      if (error.code === "NOT_GIT_REPO") {
        console.error("❌ Not a git repository. dev-workflow requires git.");
      } else if (error.code === "SLUG_NOT_FOUND" || error.code === "CONFIG_NOT_FOUND") {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nNothing to remove.");
      } else if (error.code === "WORKTREE_DETECTED") {
        console.error("❌ Cannot run uninit from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  const uninstaller = new UninstallService(fileSystem, workingDirectory, resolver);

  try {
    console.log("🗑️  Removing dev-workflow Claude integration...");

    await uninstaller.removeSkills();
    console.log("✓ Removed skills");

    await uninstaller.unregisterMCPServer();
    console.log("✓ Unregistered MCP server");

    console.log("\n✨ dev-workflow Claude integration removed!");
    console.log("\nPreserved:");
    console.log("- Project data in ~/.track/ (issues, plans, tasks)");
    console.log("- .claude/config/ (your Claude Code configuration)");
    console.log("\nTo fully remove project data, use: dev-workflow nuke");
    console.log("To archive (hide but preserve data), use: dev-workflow archive");
  } catch (error) {
    console.error("Error during uninit:", error);
    process.exit(1);
  }
}

async function runArchive(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();

  // Resolve config from .git/config → ~/.track/<slug>/config.json
  let config;
  try {
    config = await resolveConfigFromGit(workingDirectory);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      if (error.code === "NOT_GIT_REPO") {
        console.error("❌ Not a git repository. dev-workflow requires git.");
      } else if (error.code === "SLUG_NOT_FOUND" || error.code === "CONFIG_NOT_FOUND") {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nRun: dev-workflow init");
      } else if (error.code === "WORKTREE_DETECTED") {
        console.error("❌ Cannot run archive from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Create a resolver from the config (gitRoot + slug)
  const resolver = new TrackDirectoryResolver(config.gitRoot, config.slug);

  const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver);

  try {
    // Get project info first for display
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

async function runUnarchive(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();
  const packageRoot = getPackageRoot();

  // For unarchive, config.json might not exist yet (that's the point of unarchiving)
  // So we use the resolver to compute the slug, then check for archived project
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (_error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }

  // Check for worktree
  if (isWorktree(workingDirectory)) {
    console.error("❌ Cannot run unarchive from a git worktree.");
    console.error("   Run this command from the main repository.");
    process.exit(1);
  }

  const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver, packageRoot);

  try {
    // Find archived project for this repo
    const archivedProject = await archiveService.findArchivedProjectByGitHash();

    if (!archivedProject) {
      // Check if there's a non-archived project
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

async function runNuke(options: { force?: boolean }): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();

  // Resolve config from .git/config → ~/.track/<slug>/config.json
  let config;
  try {
    config = await resolveConfigFromGit(workingDirectory);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      if (error.code === "NOT_GIT_REPO") {
        console.error("❌ Not a git repository. dev-workflow requires git.");
      } else if (error.code === "SLUG_NOT_FOUND" || error.code === "CONFIG_NOT_FOUND") {
        console.error("❌ dev-workflow is not initialized for this repository.");
        console.error("\nNothing to delete.");
      } else if (error.code === "WORKTREE_DETECTED") {
        console.error("❌ Cannot run nuke from a git worktree.");
        console.error("   Run this command from the main repository.");
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Create a resolver from the config (gitRoot + slug)
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
  } finally {
    dbService.close();
  }

  const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver);

  try {
    // Get project info first for display
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

async function runUI(): Promise<void> {
  const { isPortInUse, getSavedDaemonPort } = await import("./infrastructure/port-manager.js");

  try {
    // If PORT is explicitly set, always start on that port (for E2E tests, parallel instances)
    const explicitPort = process.env["PORT"];
    if (explicitPort) {
      await UIService.startMultiProject();
      return;
    }

    // Check if daemon is already running by checking saved port
    const savedPort = getSavedDaemonPort();
    if (savedPort) {
      const serverRunning = await isPortInUse(savedPort);
      if (serverRunning) {
        const url = `http://127.0.0.1:${savedPort}`;
        console.log(`✓ dev-workflow UI is already running at ${url}`);
        return;
      }
    }

    // Server not running, start it
    await UIService.startMultiProject();
  } catch (error) {
    console.error("Error starting UI:", error);
    process.exit(1);
  }
}

async function runUIInstall(): Promise<void> {
  const { execSync } = await import("node:child_process");
  const cliPath = fileURLToPath(import.meta.url);

  console.log("🚀 Setting up dev-workflow UI auto-start with PM2...\n");

  try {
    // Check if pm2 is available
    try {
      execSync("npx pm2 --version", { stdio: "pipe" });
    } catch {
      console.error("❌ PM2 is required for auto-start.");
      console.error("   Install it with: npm install -g pm2");
      process.exit(1);
    }

    // Stop existing instance if running
    try {
      execSync("npx pm2 delete dev-workflow-ui", { stdio: "pipe" });
    } catch {
      // Ignore if not running
    }

    // Start with PM2
    const startCmd = `npx pm2 start "node ${cliPath} ui" --name dev-workflow-ui`;
    execSync(startCmd, { stdio: "inherit" });

    // Setup startup script
    console.log("\n📋 Setting up startup script...");
    try {
      execSync("npx pm2 startup", { stdio: "inherit" });
    } catch {
      console.warn("⚠️  Could not setup startup script automatically.");
      console.warn("   Run 'npx pm2 startup' manually and follow the instructions.");
    }

    // Save process list
    execSync("npx pm2 save", { stdio: "inherit" });

    console.log("\n✨ dev-workflow UI installed successfully!");
    console.log("\nThe UI is now running at: http://127.0.0.1:3456");
    console.log("It will start automatically on system boot.");
    console.log("\nUseful commands:");
    console.log("  npx pm2 status          - Check status");
    console.log("  npx pm2 logs dev-workflow-ui - View logs");
    console.log("  dev-workflow ui:uninstall   - Remove auto-start");
  } catch (error) {
    console.error("Error setting up auto-start:", error);
    process.exit(1);
  }
}

async function runUIUninstall(): Promise<void> {
  const { execSync } = await import("node:child_process");

  console.log("🗑️  Removing dev-workflow UI auto-start...\n");

  try {
    // Stop and delete from PM2
    try {
      execSync("npx pm2 delete dev-workflow-ui", { stdio: "inherit" });
    } catch {
      console.log("   (Process was not running)");
    }

    // Save to persist the removal
    try {
      execSync("npx pm2 save", { stdio: "inherit" });
    } catch {
      // Ignore
    }

    console.log("\n✨ dev-workflow UI auto-start removed.");
    console.log("\nNote: The PM2 startup script is still installed.");
    console.log("To remove it completely, run: npx pm2 unstartup");
  } catch (error) {
    console.error("Error removing auto-start:", error);
    process.exit(1);
  }
}

async function runWorkers(): Promise<void> {
  const dbPath = getGlobalDatabasePath();

  if (!fs.existsSync(dbPath)) {
    console.error("❌ Global database not found.");
    console.error("   Run: dev-workflow init");
    process.exit(1);
  }

  const dbService = await DataSourceFactory.createSqlite(dbPath);
  const db = dbService.getDb();
  const workerRepository = new SqliteWorkerRepository(db);
  const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

  try {
    // Get workers with health info
    const workers = workerRepository.findAllWithHealth();

    // Get queue stats
    const queueStats = dispatchQueueRepository.getQueueStats();

    // Get queue entries for details
    const queueEntries = dispatchQueueRepository.findAllWithHealth();

    console.log("Workers:");
    console.log("========\n");

    if (workers.length === 0) {
      console.log("  No workers registered.\n");
    } else {
      for (const worker of workers) {
        const status = worker.isAlive ? "✓" : "✗";
        const statusText = worker.isAlive ? "alive" : "dead";
        const taskInfo = worker.currentTaskId
          ? `| task: ${worker.currentTaskId.slice(0, 8)}...`
          : "";

        console.log(
          `  ${status} ${worker.name} (${worker.status}) - ${statusText}, ${worker.heartbeatAge}s ago ${taskInfo}`
        );
      }
      console.log();
    }

    console.log("Dispatch Queue:");
    console.log("===============\n");

    console.log(
      `  Total: ${queueStats.total}, Unclaimed: ${queueStats.unclaimed}, Claimed: ${queueStats.claimed}, Stale: ${queueStats.stale}\n`
    );

    if (queueEntries.length > 0) {
      console.log("  Entries:");
      for (const entry of queueEntries) {
        const staleMarker = entry.isStale ? " [STALE]" : "";
        const workerInfo = entry.workerName ? `claimed by ${entry.workerName}` : "unclaimed";
        console.log(`    - ${entry.taskId.slice(0, 8)}... (${workerInfo})${staleMarker}`);
      }
    }
  } catch (error) {
    console.error("Error listing workers:", error);
    process.exit(1);
  } finally {
    dbService.close();
  }
}

function runMcp(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const cliRoot = path.resolve(path.dirname(currentFile), "..");
  const mcpServerPath = path.resolve(cliRoot, "../mcp-server/dist/index.js");

  // MCP server expects PROJECT_SLUG to be passed via environment
  // (set by Claude's MCP integration from the registered config)
  const mcpProcess = spawn("node", [mcpServerPath], {
    stdio: "inherit",
    env: process.env,
  });

  mcpProcess.on("exit", (code) => process.exit(code || 0));
  mcpProcess.on("error", (error) => {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  });
}

const program = new Command();

program.name("dev-workflow").description("AI-driven development workflow system").version("0.1.0");

program
  .command("init")
  .description("Initialize dev-workflow in current repository")
  .option("--local", "Use local database (./.track/workflow.db) instead of global")
  .option("--url <connection-string>", "Use remote PostgreSQL database")
  .action(async (opts: { local?: boolean; url?: string }) => {
    try {
      await runInit({ local: opts.local, url: opts.url });
    } catch (error) {
      console.error("Error during initialization:", error);
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Update dev-workflow to latest version (skills, agents, migrations)")
  .action(async () => {
    try {
      await runUpdate();
    } catch (error) {
      console.error("Error during update:", error);
      process.exit(1);
    }
  });

program
  .command("uninit")
  .description("Remove dev-workflow Claude integration (skills, MCP) - preserves project data")
  .action(async () => {
    try {
      await runUninit();
    } catch (error) {
      console.error("Error during uninit:", error);
      process.exit(1);
    }
  });

program
  .command("archive")
  .description("Archive project (uninit + hide from UI) - preserves all data")
  .action(async () => {
    try {
      await runArchive();
    } catch (error) {
      console.error("Error during archive:", error);
      process.exit(1);
    }
  });

program
  .command("unarchive")
  .description("Restore archived project (reinstalls Claude integration)")
  .action(async () => {
    try {
      await runUnarchive();
    } catch (error) {
      console.error("Error during unarchive:", error);
      process.exit(1);
    }
  });

program
  .command("nuke")
  .description("PERMANENTLY DELETE all project data (requires all issues closed)")
  .option("--force", "Force local cleanup when using remote database (remote data preserved)")
  .action(async (options: { force?: boolean }) => {
    try {
      await runNuke(options);
    } catch (error) {
      console.error("Error during nuke:", error);
      process.exit(1);
    }
  });

program
  .command("mcp")
  .description("Start MCP server for Claude Code integration")
  .action(() => {
    try {
      runMcp();
    } catch (error) {
      console.error("Error starting MCP server:", error);
      process.exit(1);
    }
  });

program
  .command("ui")
  .description("Start web UI for dev-workflow (shows all projects)")
  .action(async () => {
    try {
      await runUI();
    } catch (error) {
      console.error("Error starting UI:", error);
      process.exit(1);
    }
  });

program
  .command("ui:install")
  .description("Install UI as auto-start service using PM2")
  .action(async () => {
    try {
      await runUIInstall();
    } catch (error) {
      console.error("Error installing UI service:", error);
      process.exit(1);
    }
  });

program
  .command("ui:uninstall")
  .description("Remove UI auto-start service")
  .action(async () => {
    try {
      await runUIUninstall();
    } catch (error) {
      console.error("Error uninstalling UI service:", error);
      process.exit(1);
    }
  });

program
  .command("workers")
  .description("List registered workers and dispatch queue (for debugging)")
  .action(async () => {
    try {
      await runWorkers();
    } catch (error) {
      console.error("Error listing workers:", error);
      process.exit(1);
    }
  });

program
  .command("claude")
  .description("Run as a Claude worker that polls for and executes dispatched tasks")
  .option("--name <name>", "Worker name (auto-generates worker-1, worker-2, etc. if not provided)")
  .option("--auto-claim", "Automatically claim READY tasks when dependencies complete")
  .action(async (options: { name?: string; autoClaim?: boolean }) => {
    const worker = new ClaudeWorkerService({ name: options.name, autoClaim: options.autoClaim });

    try {
      await worker.initialize();
      await worker.start();
    } catch (error) {
      console.error("Error running Claude worker:", error);
      process.exit(1);
    }
  });

// Backup command with subcommands
const backupCmd = program.command("backup").description("Backup and restore workflow database");

// Main backup command - creates a backup
backupCmd
  .command("create", { isDefault: true })
  .description("Create a backup of the workflow database")
  .action(async () => {
    const service = new BackupConfigService();
    try {
      const isConfigured = await service.isConfigured();
      if (!isConfigured) {
        console.error("❌ Backup is not configured.");
        console.error("\nRun: dev-workflow backup configure");
        process.exit(1);
      }

      console.log("📦 Creating backup...");
      const result = await service.backup();

      console.log("\n✓ Backup created successfully!");
      console.log(`  Key: ${result.key}`);
      console.log(`  Timestamp: ${result.timestamp.toISOString()}`);
      console.log(`  Checksum: ${result.checksum.slice(0, 16)}...`);

      if (result.deletedCount > 0) {
        console.log(`  Deleted ${result.deletedCount} old backup(s) (retention policy)`);
      }
    } catch (error) {
      console.error(`❌ Backup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Configure backup
backupCmd
  .command("configure")
  .description("Configure S3-compatible backup destination")
  .requiredOption("--bucket <bucket>", "S3 bucket name")
  .requiredOption("--region <region>", "AWS region (e.g., us-east-1)")
  .option("--profile <name>", "AWS profile name from ~/.aws/credentials")
  .option("--access-key <key>", "AWS access key ID (for non-AWS S3 services)")
  .option("--secret-key <key>", "AWS secret access key (for non-AWS S3 services)")
  .option("--endpoint <url>", "Custom S3 endpoint (for R2, MinIO, etc.)")
  .option("--retention <count>", "Number of backups to keep", "20")
  .option("--create-bucket", "Create the bucket if it doesn't exist")
  .option("--validate", "Validate credentials before saving configuration")
  .action(async (options) => {
    const service = new BackupConfigService();
    try {
      const retentionCount = parseInt(options.retention, 10);
      if (isNaN(retentionCount) || retentionCount < 1) {
        console.error("❌ Retention count must be a positive integer");
        process.exit(1);
      }

      // Validate credential options
      const hasExplicitCreds = options.accessKey && options.secretKey;
      const hasPartialCreds =
        (options.accessKey && !options.secretKey) || (!options.accessKey && options.secretKey);

      if (hasPartialCreds) {
        console.error("❌ Both --access-key and --secret-key must be provided together");
        process.exit(1);
      }

      const s3Config = {
        bucket: options.bucket,
        region: options.region,
        profile: options.profile,
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
        endpoint: options.endpoint,
      };

      // Validate credentials and check bucket if --validate or --create-bucket
      if (options.validate || options.createBucket) {
        console.log("Validating credentials...");
        const validation = await service.validateS3Credentials(s3Config);

        if (!validation.success) {
          console.error(`❌ ${validation.error}`);
          process.exit(1);
        }
        console.log("✓ Credentials are valid!");

        if (!validation.bucketExists) {
          if (options.createBucket) {
            console.log(`\nBucket '${options.bucket}' does not exist. Creating...`);
            const createResult = await service.createS3Bucket(s3Config);

            if (createResult.success) {
              console.log(`✓ Bucket '${options.bucket}' created successfully!`);
            } else {
              console.error(`❌ Failed to create bucket: ${createResult.error}`);
              process.exit(1);
            }
          } else {
            console.error(`\n❌ Bucket '${options.bucket}' does not exist.`);
            console.error("   Use --create-bucket to create it automatically.");
            process.exit(1);
          }
        } else {
          console.log(`✓ Bucket '${options.bucket}' exists and is accessible.`);
        }
        console.log();
      }

      const result = await service.configureS3(s3Config, retentionCount);

      if (result.success) {
        console.log("✓ Backup configured successfully!");
        console.log(`  Provider: S3-compatible`);
        console.log(`  Bucket: ${options.bucket}`);
        console.log(`  Region: ${options.region}`);
        console.log(`  Retention: ${retentionCount} backups`);
        if (options.profile) {
          console.log(`  AWS Profile: ${options.profile}`);
        } else if (hasExplicitCreds) {
          console.log(`  Auth: Explicit credentials`);
        } else {
          console.log(`  Auth: Default AWS credential chain`);
        }
        if (options.endpoint) {
          console.log(`  Endpoint: ${options.endpoint}`);
        }
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(
        `❌ Configuration failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Interactive backup setup wizard
backupCmd
  .command("setup")
  .description("Interactive setup wizard for backup configuration")
  .action(async () => {
    const service = new BackupConfigService();
    const readline = await import("node:readline");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer.trim());
        });
      });
    };

    try {
      console.log("\n📦 Backup Setup Wizard\n");
      console.log("This wizard will help you configure S3-compatible backup storage.");
      console.log("Your credentials will be validated before saving.\n");

      // Step 1: Auth method selection
      console.log("Step 1: Authentication Method\n");
      console.log("  1. AWS Profile (from ~/.aws/credentials)");
      console.log("  2. Explicit credentials (access key + secret key)");
      console.log("  3. Default AWS credential chain (env vars, IAM role, etc.)\n");

      let authMethod: "profile" | "explicit" | "default" | null = null;
      while (!authMethod) {
        const choice = await question("Select auth method (1-3): ");
        if (choice === "1") authMethod = "profile";
        else if (choice === "2") authMethod = "explicit";
        else if (choice === "3") authMethod = "default";
        else console.log("Please enter 1, 2, or 3.");
      }

      // Gather auth-specific details
      let profile: string | undefined;
      let accessKeyId: string | undefined;
      let secretAccessKey: string | undefined;

      if (authMethod === "profile") {
        profile = await question("\nAWS profile name: ");
        if (!profile) {
          console.error("\n❌ Profile name is required.");
          process.exit(1);
        }
      } else if (authMethod === "explicit") {
        accessKeyId = await question("\nAWS Access Key ID: ");
        if (!accessKeyId) {
          console.error("\n❌ Access Key ID is required.");
          process.exit(1);
        }
        secretAccessKey = await question("AWS Secret Access Key: ");
        if (!secretAccessKey) {
          console.error("\n❌ Secret Access Key is required.");
          process.exit(1);
        }
      }

      // Step 2: Bucket and region
      console.log("\nStep 2: S3 Bucket Configuration\n");

      const bucket = await question("S3 bucket name: ");
      if (!bucket) {
        console.error("\n❌ Bucket name is required.");
        process.exit(1);
      }

      const region = await question("AWS region (e.g., us-east-1): ");
      if (!region) {
        console.error("\n❌ Region is required.");
        process.exit(1);
      }

      // Optional: custom endpoint for S3-compatible services
      const endpointInput = await question("Custom endpoint (leave empty for AWS S3): ");
      const endpoint = endpointInput || undefined;

      // Optional: retention count
      const retentionInput = await question("Number of backups to keep [20]: ");
      const retentionCount = retentionInput ? parseInt(retentionInput, 10) : 20;
      if (isNaN(retentionCount) || retentionCount < 1) {
        console.error("\n❌ Retention count must be a positive integer.");
        process.exit(1);
      }

      // Build the config
      const s3Config = {
        bucket,
        region,
        profile,
        accessKeyId,
        secretAccessKey,
        endpoint,
      };

      // Step 3: Validate credentials
      console.log("\nStep 3: Validating credentials...\n");

      const validation = await service.validateS3Credentials(s3Config);

      if (!validation.success) {
        console.error(`❌ Validation failed: ${validation.error}`);
        process.exit(1);
      }

      console.log("✓ Credentials are valid!\n");

      // Step 4: Check bucket existence
      if (!validation.bucketExists) {
        console.log(`⚠️  Bucket '${bucket}' does not exist.\n`);

        const createChoice = await question("Would you like to create it? (y/n): ");

        if (createChoice.toLowerCase() === "y" || createChoice.toLowerCase() === "yes") {
          console.log("\nCreating bucket...");

          const createResult = await service.createS3Bucket(s3Config);

          if (createResult.success) {
            console.log(`✓ Bucket '${bucket}' created successfully!\n`);
          } else {
            console.error(`\n❌ Failed to create bucket: ${createResult.error}`);
            console.log("\nYou can create the bucket manually and run this wizard again.");
            process.exit(1);
          }
        } else {
          console.log("\nPlease create the bucket manually and run this wizard again.");
          process.exit(0);
        }
      } else {
        console.log(`✓ Bucket '${bucket}' exists and is accessible.\n`);
      }

      // Step 5: Save configuration
      console.log("Saving configuration...\n");

      const result = await service.configureS3(s3Config, retentionCount);

      if (result.success) {
        console.log("✓ Backup configured successfully!\n");
        console.log("Configuration:");
        console.log(`  Provider: S3-compatible`);
        console.log(`  Bucket: ${bucket}`);
        console.log(`  Region: ${region}`);
        console.log(`  Retention: ${retentionCount} backups`);
        if (profile) {
          console.log(`  AWS Profile: ${profile}`);
        } else if (accessKeyId) {
          console.log(`  Auth: Explicit credentials`);
        } else {
          console.log(`  Auth: Default AWS credential chain`);
        }
        if (endpoint) {
          console.log(`  Endpoint: ${endpoint}`);
        }
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`\n❌ Setup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      rl.close();
      service.close();
    }
  });

// Show backup configuration
backupCmd
  .command("status")
  .description("Show current backup configuration")
  .action(async () => {
    const service = new BackupConfigService();
    try {
      const config = await service.getConfig();

      if (!config) {
        console.log("Backup is not configured.");
        console.log("\nRun: dev-workflow backup configure --help");
        return;
      }

      console.log("Backup Configuration:");
      console.log(`  Provider: ${config.provider}`);
      console.log(`  Bucket: ${config.s3.bucket}`);
      console.log(`  Region: ${config.s3.region}`);
      console.log(`  Retention: ${config.retentionCount} backups`);

      // Show auth method
      if (config.s3.accessKeyId) {
        console.log(`  Auth: Explicit credentials (${config.s3.accessKeyId.slice(0, 4)}...)`);
      } else if (config.s3.profile) {
        console.log(`  AWS Profile: ${config.s3.profile}`);
      } else {
        console.log(`  Auth: Default AWS credential chain`);
      }

      if (config.s3.endpoint) {
        console.log(`  Endpoint: ${config.s3.endpoint}`);
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// List available backups
backupCmd
  .command("list")
  .description("List available backups")
  .action(async () => {
    const service = new BackupConfigService();
    try {
      const isConfigured = await service.isConfigured();
      if (!isConfigured) {
        console.error("❌ Backup is not configured.");
        console.error("\nRun: dev-workflow backup configure");
        process.exit(1);
      }

      console.log("Fetching backups...\n");
      const backups = await service.listBackups();

      if (backups.length === 0) {
        console.log("No backups found.");
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
        return;
      }

      console.log(`Found ${backups.length} backup(s):\n`);

      for (const backup of backups) {
        const sizeKB = (backup.sizeBytes / 1024).toFixed(1);
        console.log(`  ${backup.timestamp.toISOString()}`);
        console.log(`    Key: ${backup.key}`);
        console.log(`    Size: ${sizeKB} KB`);
        if (backup.checksum) {
          console.log(`    Checksum: ${backup.checksum.slice(0, 16)}...`);
        }
        console.log();
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Remove backup configuration
backupCmd
  .command("unconfigure")
  .description("Remove backup configuration")
  .action(async () => {
    const service = new BackupConfigService();
    try {
      const result = await service.removeConfig();

      if (result.success) {
        console.log("✓ Backup configuration removed.");
        console.log("\nNote: Existing backups in S3 are not deleted.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Restore command (top-level for convenience)
program
  .command("restore [backup]")
  .description("Restore workflow database from a backup")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--no-safety-backup", "Skip creating a safety backup of current database")
  .action(
    async (backup: string | undefined, options: { yes?: boolean; safetyBackup?: boolean }) => {
      const service = new BackupConfigService();
      try {
        const isConfigured = await service.isConfigured();
        if (!isConfigured) {
          console.error("❌ Backup is not configured.");
          console.error("\nRun: dev-workflow backup configure");
          process.exit(1);
        }

        // Get list of backups to show context
        const backups = await service.listBackups();
        if (backups.length === 0) {
          console.error("❌ No backups available to restore.");
          console.error("\nRun 'dev-workflow backup' to create a backup first.");
          process.exit(1);
        }

        // Determine which backup to restore
        let backupIdentifier: string;
        if (backup) {
          backupIdentifier = backup;
        } else {
          // Default to most recent
          backupIdentifier = "1";
          console.log("No backup specified, will restore most recent backup.\n");
        }

        // Show backup details and confirm
        const targetBackup = backupIdentifier === "1" || !backup ? backups[0] : undefined;

        if (targetBackup) {
          console.log("Backup to restore:");
          console.log(`  Timestamp: ${targetBackup.timestamp.toISOString()}`);
          console.log(`  Size: ${(targetBackup.sizeBytes / 1024).toFixed(1)} KB`);
          if (targetBackup.checksum) {
            console.log(`  Checksum: ${targetBackup.checksum.slice(0, 16)}...`);
          }
        } else {
          console.log(`Backup identifier: ${backupIdentifier}`);
        }

        console.log(`\nTarget: ${service.getDatabasePath()}`);

        // Confirmation prompt
        if (!options.yes) {
          console.log("\n⚠️  WARNING: This will REPLACE your current workflow database!");
          console.log(
            "   All current issues, plans, and tasks will be replaced with the backup.\n"
          );

          const readline = await import("node:readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question("Type 'restore' to confirm: ", (answer) => {
              rl.close();
              resolve(answer);
            });
          });

          if (answer.toLowerCase() !== "restore") {
            console.log("\n❌ Restore cancelled.");
            process.exit(1);
          }
        }

        // Create safety backup if enabled
        if (options.safetyBackup !== false) {
          console.log("\n📋 Creating safety backup of current database...");
          try {
            const safetyPath = await service.createSafetyBackup();
            console.log(`✓ Safety backup created: ${safetyPath}`);
          } catch (error) {
            console.error(
              `⚠️  Could not create safety backup: ${error instanceof Error ? error.message : String(error)}`
            );
            console.error("   Proceeding with restore anyway...");
          }
        }

        // Perform restore
        console.log("\n📥 Downloading and restoring backup...");
        const result = await service.restore(backupIdentifier);

        console.log("\n✓ Database restored successfully!");
        console.log(`  From: ${result.key}`);
        console.log(`  Timestamp: ${result.timestamp.toISOString()}`);
        console.log(`  Restored to: ${result.restoredTo}`);

        console.log("\n⚠️  IMPORTANT: Restart Claude Code to reload the restored data.");
      } catch (error) {
        console.error(
          `\n❌ Restore failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      } finally {
        service.close();
      }
    }
  );

// Database command with subcommands
const databaseCmd = program
  .command("database")
  .description("Configure database connection (local SQLite or remote PostgreSQL)");

// Configure remote database
databaseCmd
  .command("configure")
  .description("Configure database connection")
  .option(
    "--url <connection-string>",
    "PostgreSQL connection URL (e.g., postgresql://user:pass@host/db)"
  )
  .option("--local", "Reset to local SQLite database")
  .action(async (options: { url?: string; local?: boolean }) => {
    const service = new DatabaseConfigService();

    try {
      // Validate options
      if (options.url && options.local) {
        console.error("❌ Cannot specify both --url and --local");
        process.exit(1);
      }

      if (!options.url && !options.local) {
        console.error("❌ Must specify either --url <connection-string> or --local");
        console.error("\nExamples:");
        console.error(
          "  dev-workflow database configure --url postgresql://user:pass@host.neon.tech/db"
        );
        console.error("  dev-workflow database configure --local");
        process.exit(1);
      }

      if (options.local) {
        console.log("🔧 Resetting to local SQLite database...\n");
        const result = await service.configureLocal();

        if (result.success) {
          console.log("✓ " + result.message);
          console.log(`  Path: ${service.getDatabasePath()}`);
          console.log("\n⚠️  IMPORTANT: Restart Claude Code to use the new configuration.");
        } else {
          console.error(`❌ ${result.message}`);
          process.exit(1);
        }
      } else if (options.url) {
        console.log("🔧 Configuring remote database...\n");
        console.log("Validating connection...");

        const result = await service.configureRemote(options.url);

        if (result.success) {
          console.log("\n✓ " + result.message);
          console.log(`  URL: ${DatabaseConfigService.maskPassword(options.url)}`);
          console.log("\n⚠️  IMPORTANT: Restart Claude Code to use the new configuration.");
        } else {
          console.error(`\n❌ ${result.message}`);
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Show database status
databaseCmd
  .command("status")
  .description("Show current database configuration")
  .action(async () => {
    const service = new DatabaseConfigService();

    try {
      const status = await service.getStatus();

      console.log("Database Configuration:");
      console.log(`  Provider: ${status.provider}`);
      console.log(`  Connection: ${DatabaseConfigService.maskPassword(status.connectionString)}`);
      console.log(
        `  Source: ${status.source === "env" ? `environment (${TRACK_DATABASE_URL_ENV})` : status.source === "config" ? "stored configuration" : "default"}`
      );

      if (status.configuredAt) {
        console.log(`  Configured at: ${status.configuredAt}`);
      }

      if (status.source === "env") {
        console.log(
          `\n⚠️  Note: Environment variable ${TRACK_DATABASE_URL_ENV} overrides stored configuration.`
        );
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      service.close();
    }
  });

// Pull command - deprecated, replaced by init --url
program
  .command("pull [connection-string]")
  .description("[DEPRECATED] Use 'dev-workflow init --url <connection-string>' instead")
  .action(async (connectionString?: string) => {
    console.error("❌ The 'pull' command is deprecated.");
    console.error("");
    console.error("Use 'dev-workflow init --url' instead:");
    if (connectionString) {
      console.error(`  dev-workflow init --url "${connectionString}"`);
    } else {
      console.error("  dev-workflow init --url postgresql://user:password@host/database");
    }
    console.error("");
    console.error("The init command now supports three modes:");
    console.error("  dev-workflow init              # Global database (~/.track/workflow.db)");
    console.error("  dev-workflow init --local      # Local database (./.track/workflow.db)");
    console.error("  dev-workflow init --url <url>  # Remote PostgreSQL database");
    process.exit(1);
  });

program
  .command("clean-claude-config")
  .description("Remove stale worktree folder registrations from ~/.claude.json")
  .option("--dry-run", "Show what would be removed without making changes")
  .action(async (options: { dryRun?: boolean }) => {
    const service = new ClaudeConfigService();

    try {
      if (options.dryRun) {
        console.log("🔍 Scanning for stale worktree registrations...\n");
        const registrations = await service.listWorktreeRegistrations();

        if (registrations.length === 0) {
          console.log("No worktree registrations found in ~/.claude.json");
          return;
        }

        console.log(`Found ${registrations.length} worktree registration(s):\n`);

        let staleCount = 0;
        for (const regPath of registrations) {
          try {
            await fsp.access(regPath);
            console.log(`  ✓ ${regPath} (exists)`);
          } catch {
            console.log(`  ✗ ${regPath} (stale - would be removed)`);
            staleCount++;
          }
        }

        console.log();
        if (staleCount > 0) {
          console.log(`Would remove ${staleCount} stale registration(s).`);
          console.log("Run without --dry-run to apply changes.");
        } else {
          console.log("No stale registrations found.");
        }
        return;
      }

      console.log("🧹 Cleaning stale worktree registrations from ~/.claude.json...\n");
      const result = await service.cleanStaleWorktrees();

      if (!result.success) {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }

      if (result.removedCount === 0) {
        console.log("✓ No stale registrations found.");
      } else {
        console.log(`✓ Removed ${result.removedCount} stale registration(s):\n`);
        for (const removedPath of result.removedPaths) {
          console.log(`  - ${removedPath}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

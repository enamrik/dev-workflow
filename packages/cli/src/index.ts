#!/usr/bin/env node

import { Command } from "commander";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import { InstallService } from "./application/install.service.js";
import { UpdateService } from "./application/update.service.js";
import { UninstallService } from "./application/uninstall.service.js";
import { ArchiveService, ArchiveError } from "./application/archive.service.js";
import { UIService } from "./application/ui.service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";
import { createTrackDirectoryResolver } from "@dev-workflow/core";

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

async function runInit(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();
  const packageRoot = getPackageRoot();

  // Check for git repository and at least one commit
  if (!hasGitCommit(workingDirectory)) {
    // Check if it's a git repo at all
    try {
      execSync("git rev-parse --git-dir", { cwd: workingDirectory, stdio: ["pipe", "pipe", "pipe"] });
      // It's a git repo but no commits
      console.error("❌ No commits found. dev-workflow requires at least one commit.");
      console.error("   Run: git commit --allow-empty -m \"Initial commit\"");
      process.exit(1);
    } catch {
      // Not a git repo
      console.error("❌ Not a git repository. dev-workflow requires git.");
      process.exit(1);
    }
  }

  // Create resolver to get global track directory path
  const resolver = createTrackDirectoryResolver(workingDirectory);
  const installer = new InstallService(fileSystem, workingDirectory, packageRoot, resolver);

  // Check if this project already exists in the database (by gitRootHash)
  const existingProject = await installer.findExistingProject();
  const trackDir = resolver.getTrackDirectory();
  const trackDirExists = fs.existsSync(trackDir);

  // Check if project is archived - auto-unarchive if so
  if (existingProject && existingProject.isArchived) {
    console.log("📦 Detected archived project, restoring...");
    console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);

    try {
      const archiveService = new ArchiveService(fileSystem, workingDirectory, resolver, packageRoot);
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
    const needsRepair = await installer.needsConfigRepair();

    // Repair mode: project exists - run repair to ensure everything is up to date
    // This makes `init` idempotent and safe to run multiple times
    if (needsRepair || !trackDirExists) {
      console.log("🔧 Repairing dev-workflow configuration...");
      console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)`);
      console.log(`   Detected: Repository has moved or config is missing\n`);
    } else {
      console.log("🔧 Re-initializing dev-workflow...");
      console.log(`   Project: ${existingProject.name} (${existingProject.id.slice(0, 8)}...)\n`);
    }

    try {
      // Use existing project
      installer.setProject(existingProject);

      // Ensure database is up to date
      await installer.initializeDatabase();

      // Ensure track directory exists
      if (!trackDirExists) {
        await installer.createTrackDirectory();
        console.log(`✓ Recreated ${trackDir}`);

        await installer.createTaskLabels();
        console.log("✓ Recreated task labels");
      }

      // Update local config with new gitRoot
      await installer.createLocalConfig();
      console.log("✓ Updated local config with new path");

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

    // Initialize database first (needed for project registration)
    await installer.initializeDatabase();
    console.log("✓ Initialized database");

    // Register project in database (uses git initial commit hash as stable ID)
    const project = await installer.registerProject();
    console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

    await installer.createTrackDirectory();

    // Create local config with machine-specific settings (gitRoot)
    await installer.createLocalConfig();
    console.log("✓ Created local config");
    console.log(`✓ Created ${trackDir}`);

    await installer.createTaskLabels();
    console.log("✓ Created task labels");

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

  // Create resolver
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }

  const updater = new UpdateService(fileSystem, workingDirectory, packageRoot, resolver);

  try {
    // Check if initialized
    const isInitialized = await updater.isInitialized();
    if (!isInitialized) {
      console.error("❌ dev-workflow is not initialized for this repository.");
      console.error(`   Project: ${resolver.getProjectId()}`);
      console.error("\nRun: dev-workflow init");
      process.exit(1);
    }

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
    console.log("✓ Updated templates");

    await updater.updateTaskLabels();
    console.log("✓ Updated task labels");

    await updater.runMigrations();
    console.log("✓ Ran database migrations");

    // Register/update project in database (uses git initial commit hash as stable ID)
    const project = await updater.registerProject();
    console.log(`✓ Registered project: ${project.name} (${project.id.slice(0, 8)}...)`);

    // Migrate existing issues from old path-based projectId to new UUID
    const migrationResult = await updater.migrateIssues();
    if (migrationResult.migrated > 0) {
      console.log(`✓ Migrated ${migrationResult.migrated} issues from ${migrationResult.oldProjectId} to ${project.id.slice(0, 8)}...`);
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

  // Create resolver
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }

  // Check if initialized (skills exist or MCP is registered)
  const skillsDir = path.join(workingDirectory, ".claude/skills");
  const hasDwfSkills = fs.existsSync(skillsDir) &&
    fs.readdirSync(skillsDir).some(name => name.startsWith("dwf-"));

  if (!hasDwfSkills) {
    console.error("❌ dev-workflow is not initialized for this repository.");
    console.error("\nNothing to remove.");
    process.exit(1);
  }

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

  // Create resolver
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }

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

  // Create resolver
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
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

async function runNuke(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();

  // Create resolver
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
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

        // Open browser
        if (!process.env["NO_OPEN_BROWSER"]) {
          const open = (await import("open")).default;
          try {
            await open(url);
            console.log("  Opening browser...");
          } catch {
            console.warn("⚠️  Could not open browser automatically.");
            console.warn(`   Please visit: ${url}`);
          }
        }
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

function runMcp(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const cliRoot = path.resolve(path.dirname(currentFile), "..");
  const mcpServerPath = path.resolve(cliRoot, "../mcp-server/dist/index.js");

  const mcpProcess = spawn("node", [mcpServerPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_PATH: process.env["DATABASE_PATH"] || "./data/workflow.db",
      TEMPLATES_PATH: process.env["TEMPLATES_PATH"] || "./.track/config/issues/templates/",
    },
  });

  mcpProcess.on("exit", (code) => process.exit(code || 0));
  mcpProcess.on("error", (error) => {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  });
}

const program = new Command();

program
  .name("dev-workflow")
  .description("AI-driven development workflow system")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize dev-workflow in current repository")
  .action(async () => {
    try {
      await runInit();
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
  .action(async () => {
    try {
      await runNuke();
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

program.parse(process.argv);

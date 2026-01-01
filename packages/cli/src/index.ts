#!/usr/bin/env node

import { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import { InstallService } from "./application/install.service.js";
import { UpdateService } from "./application/update.service.js";
import { UninstallService } from "./application/uninstall.service.js";
import { UIService } from "./application/ui.service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";
import { createTrackDirectoryResolver } from "@dev-workflow/core";

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

  // Create resolver to get global track directory path
  let resolver;
  try {
    resolver = createTrackDirectoryResolver(workingDirectory);
  } catch (error) {
    console.error("❌ Not a git repository. dev-workflow requires git.");
    process.exit(1);
  }

  // Check if already initialized (in global ~/.track/<project-id>/)
  const trackDir = resolver.getTrackDirectory();
  const alreadyInitialized = fs.existsSync(trackDir);

  if (alreadyInitialized) {
    console.error("❌ dev-workflow is already initialized for this repository.");
    console.error(`   Project: ${resolver.getProjectId()}`);
    console.error(`   Data: ${trackDir}`);
    console.error("\nIf you want to update, run: dev-workflow update");
    process.exit(1);
  }

  const installer = new InstallService(fileSystem, workingDirectory, packageRoot, resolver);

  try {
    console.log("🚀 Initializing dev-workflow...");
    console.log(`   Project: ${resolver.getProjectId()}`);

    await installer.createTrackDirectory();
    console.log(`✓ Created ${trackDir}`);

    await installer.createTaskSkills();
    console.log("✓ Created task labels");

    await installer.installSkills();
    console.log("✓ Installed skills");

    await installer.installSubagents();
    console.log("✓ Installed subagents");

    await installer.registerMCPServer();
    console.log("✓ Registered MCP server");

    await installer.initializeDatabase();
    console.log("✓ Initialized database");

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
    console.log(`   Project: ${resolver.getProjectId()}`);

    await updater.updateSkills();
    console.log("✓ Updated skills");

    await updater.updateSubagents();
    console.log("✓ Updated subagents");

    await updater.updateTemplates();
    console.log("✓ Updated templates");

    await updater.updateTaskSkills();
    console.log("✓ Updated task labels");

    await updater.updateMCPServer();
    console.log("✓ Updated MCP server registration");

    await updater.runMigrations();
    console.log("✓ Ran database migrations");

    await updater.restartUIDaemonIfRunning();

    console.log("\n✨ dev-workflow updated successfully!");
    console.log("\nChanges:");
    console.log("- Skills and subagents updated to latest version");
    console.log("- New templates added (existing customizations preserved)");
    console.log("- MCP server registration refreshed");
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

  // Check if initialized
  const trackDir = resolver.getTrackDirectory();
  const isInitialized = fs.existsSync(trackDir);

  if (!isInitialized) {
    console.error("❌ dev-workflow is not initialized for this repository.");
    console.error(`   Project: ${resolver.getProjectId()}`);
    console.error("\nNothing to remove.");
    process.exit(1);
  }

  const uninstaller = new UninstallService(fileSystem, workingDirectory, resolver);

  try {
    console.log("🗑️  Uninstalling dev-workflow...");
    console.log(`   Project: ${resolver.getProjectId()}`);

    await uninstaller.removeTrackDirectory();
    console.log(`✓ Removed ${trackDir}`);

    await uninstaller.removeSkills();
    console.log("✓ Removed skills");

    await uninstaller.removeSubagents();
    console.log("✓ Removed subagents");

    await uninstaller.unregisterMCPServer();
    console.log("✓ Unregistered MCP server");

    console.log("\n✨ dev-workflow uninstalled successfully!");
    console.log("\nPreserved:");
    console.log("- .claude/config/ (your Claude Code configuration)");
    console.log("- Other .claude/ contents (your other integrations)");
  } catch (error) {
    console.error("Error during uninstall:", error);
    process.exit(1);
  }
}

async function runUI(): Promise<void> {
  try {
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
  .description("Uninstall dev-workflow from current repository")
  .action(async () => {
    try {
      await runUninit();
    } catch (error) {
      console.error("Error during uninstall:", error);
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

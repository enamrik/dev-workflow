#!/usr/bin/env node

import { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { InstallService } from "./application/install.service.js";
import { UpdateService } from "./application/update.service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";

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

  // Check if already initialized
  const trackDir = path.join(workingDirectory, ".track");
  const alreadyInitialized = await fileSystem.exists(trackDir);

  if (alreadyInitialized) {
    console.error("❌ dev-workflow is already initialized in this directory.");
    console.error("\nIf you want to update, run: dev-workflow update");
    console.error("If you want to reinstall, first remove .track/ and .claude/ directories.");
    process.exit(1);
  }

  const installer = new InstallService(fileSystem, workingDirectory, packageRoot);

  try {
    console.log("🚀 Initializing dev-workflow...");

    await installer.createTrackDirectory();
    console.log("✓ Created .track/ directory");

    await installer.installSkills();
    console.log("✓ Installed skills");

    await installer.installSubagents();
    console.log("✓ Installed subagents");

    await installer.registerMCPServer();
    console.log("✓ Registered MCP server");

    await installer.initializeDatabase();
    console.log("✓ Initialized database");

    const issue = await installer.createWelcomeIssue();
    console.log(`✓ Created issue #${issue.number}: "${issue.title}"`);

    console.log("\n✨ dev-workflow initialized successfully!");
    console.log("\nNext steps:");
    console.log("1. Open Claude Code in this repository");
    console.log('2. Say: "Show me issue #1"');
    console.log('3. Or use: /issue to create new issues');
  } catch (error) {
    console.error("Error during initialization:", error);
    process.exit(1);
  }
}

async function runUpdate(): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const workingDirectory = process.cwd();
  const packageRoot = getPackageRoot();

  const updater = new UpdateService(fileSystem, workingDirectory, packageRoot);

  try {
    // Check if initialized
    const isInitialized = await updater.isInitialized();
    if (!isInitialized) {
      console.error("❌ dev-workflow is not initialized in this directory.");
      console.error("\nRun: dev-workflow init");
      process.exit(1);
    }

    console.log("🔄 Updating dev-workflow...");

    await updater.updateSkills();
    console.log("✓ Updated skills");

    await updater.updateSubagents();
    console.log("✓ Updated subagents");

    await updater.updateTemplates();
    console.log("✓ Updated templates");

    await updater.updateMCPServer();
    console.log("✓ Updated MCP server registration");

    await updater.runMigrations();
    console.log("✓ Ran database migrations");

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

program.parse(process.argv);

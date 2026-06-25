#!/usr/bin/env node

/**
 * dev-workflow CLI
 *
 * AI-driven development workflow system. All commands use Awilix DI
 * for testability and clean architecture.
 */

import { Command } from "commander";

// Import runners from command definition files
import { runInit } from "./commands/init-command-def.js";
import { runUpdate } from "./commands/update-command-def.js";
import { runUninit } from "./commands/uninit-command-def.js";
import { runUI, runUIInstall, runUIUninstall } from "./commands/ui-command-def.js";
import { runWorkers, runClaudeWorker } from "./commands/worker-command-def.js";
import { runMCP } from "./commands/mcp-command-def.js";
import { runCleanClaudeConfig } from "./commands/claude-config-command-def.js";

const program = new Command();

program.name("dev-workflow").description("AI-driven development workflow system").version("0.1.0");

program
  .command("init")
  .description("Initialize dev-workflow in current repository")
  .action(async () => {
    await runInit({});
  });

program
  .command("update")
  .description("Update dev-workflow to latest version (skills, agents, migrations)")
  .action(runUpdate);

program
  .command("uninit")
  .description("Remove dev-workflow Claude integration (skills, MCP) - preserves project data")
  .action(runUninit);

program.command("mcp").description("Start MCP server for Claude Code integration").action(runMCP);

program
  .command("ui")
  .description("Start web UI for dev-workflow (shows all projects)")
  .action(runUI);

program
  .command("ui:install")
  .description("Install UI as auto-start service using PM2")
  .action(runUIInstall);

program.command("ui:uninstall").description("Remove UI auto-start service").action(runUIUninstall);

program
  .command("workers")
  .description("List registered workers and dispatch queue (for debugging)")
  .action(runWorkers);

program
  .command("claude")
  .description("Run as a Claude worker that polls for and executes dispatched tasks")
  .option("--name <name>", "Worker name (auto-generates worker-1, worker-2, etc. if not provided)")
  .option("--auto-claim", "Automatically claim READY tasks when dependencies complete")
  .action(async (options: { name?: string; autoClaim?: boolean }) => {
    await runClaudeWorker(options);
  });

program
  .command("clean-claude-config")
  .description("Remove stale worktree folder registrations from ~/.claude.json")
  .option("--dry-run", "Show what would be removed without making changes")
  .action(async (options: { dryRun?: boolean }) => {
    await runCleanClaudeConfig(options);
  });

program.parse(process.argv);

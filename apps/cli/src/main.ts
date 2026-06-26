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
import { runUI, runUIStop, runUIStatus } from "./commands/ui-command-def.js";
import { runWorkers, runClaudeWorker } from "./commands/worker-command-def.js";
import { runMCP } from "./commands/mcp-command-def.js";
import { runCleanClaudeConfig } from "./commands/claude-config-command-def.js";
import { runSetup } from "./commands/setup-command-def.js";

// Injected at bundle time by tsup (define: __DFL_VERSION__). Undefined in dev/tsc builds —
// the typeof guard avoids a ReferenceError there and falls back to a dev marker.
declare const __DFL_VERSION__: string;
const VERSION = typeof __DFL_VERSION__ !== "undefined" ? __DFL_VERSION__ : "0.0.0-dev";

const program = new Command();

program.name("dfl").description("AI-driven development workflow system").version(VERSION);

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
  .description("Start the web UI as a background daemon (shows all projects)")
  .option("--foreground", "Run in the foreground instead of daemonizing (for debugging)")
  .action((options) => runUI(options));

program.command("ui:stop").description("Stop the web UI daemon").action(runUIStop);

program
  .command("ui:status")
  .description("Show whether the web UI daemon is running")
  .action(runUIStatus);

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

program
  .command("setup")
  .description("Check and optionally install external dependencies")
  .option("--fix", "Attempt to install missing dependencies")
  .action(async (options: { fix?: boolean }) => {
    await runSetup(options);
  });

program.parse(process.argv);

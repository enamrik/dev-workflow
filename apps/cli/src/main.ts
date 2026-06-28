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
import { runWorkers, runSuperviseWorker, runWorkerLogs } from "./commands/worker-command-def.js";
import { runWorkerRun } from "./commands/worker-run-command-def.js";
import { runMCP } from "./commands/mcp-command-def.js";
import { runCleanClaudeConfig } from "./commands/claude-config-command-def.js";
import { runGithubIdentity } from "./commands/github-identity-command-def.js";
import { runSetup } from "./commands/setup-command-def.js";
import { runUninstall } from "./commands/uninstall-command-def.js";
import { printVersionBanner } from "./version-banner.js";

// Injected at bundle time by tsup (define: __DFL_VERSION__). Undefined in dev/tsc builds —
// the typeof guard avoids a ReferenceError there and falls back to a dev marker.
declare const __DFL_VERSION__: string;
const VERSION = typeof __DFL_VERSION__ !== "undefined" ? __DFL_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("dfl")
  .description("AI-driven development workflow system")
  .version(VERSION)
  .enablePositionalOptions();

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

program
  .command("uninstall")
  .description("Fully uninstall dfl (removes install dir, launcher, skills, MCP registration)")
  .option("--purge", "Also remove all data in ~/.dfl/track (issues, plans, tasks)")
  .action(async (options: { purge?: boolean }) => {
    await runUninstall(options);
  });

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
  .command("worker:logs")
  .description("Show per-task worker session log paths (newest first), or tail the latest")
  .option("--name <name>", "Filter to a specific worker name")
  .option("--tail", "Follow the latest log with tail -f")
  .action(runWorkerLogs);

program
  .command("claude")
  .description("Run as a Claude worker that polls for and executes dispatched tasks")
  .option("--name <name>", "Worker name (auto-generates worker-1, worker-2, etc. if not provided)")
  .passThroughOptions()
  .action(async (options: { name?: string }, cmd: Command) => {
    // The `claude` verb is the long-lived SUPERVISOR; it spawns the worker loop
    // as a replaceable child via the hidden `__worker-run` verb below.
    await runSuperviseWorker({ ...options, claudeArgs: cmd.args, runningVersion: VERSION });
  });

// Hidden child verb: the replaceable worker process the supervisor spawns. Same
// surface as `claude` (--name + passthrough), plus --running-version which the
// supervisor passes through buildWorkerRunArgs. Hidden so it never shows in
// help — it is an internal handoff target, not a user-facing command.
program
  .command("__worker-run", { hidden: true })
  .description("Internal: run the worker loop as a supervised child process")
  .option("--name <name>", "Worker name")
  .option("--running-version <version>", "Running dfl build version")
  .passThroughOptions()
  .action(async (options: { name?: string; runningVersion?: string }, cmd: Command) => {
    await runWorkerRun({ ...options, claudeArgs: cmd.args });
  });

program
  .command("clean-claude-config")
  .description("Remove stale worktree folder registrations from ~/.claude.json")
  .option("--dry-run", "Show what would be removed without making changes")
  .action(async (options: { dryRun?: boolean }) => {
    await runCleanClaudeConfig(options);
  });

program
  .command("github-identity [user]")
  .description(
    "Set or show the GitHub account dfl uses for this repo's push/PR (per-project, no global gh switch)"
  )
  .action(async (user?: string) => {
    await runGithubIdentity({ user });
  });

program
  .command("setup")
  .description("Check and optionally install external dependencies")
  .option("--fix", "Attempt to install missing dependencies")
  .action(async (options: { fix?: boolean }) => {
    await runSetup(options);
  });

printVersionBanner(VERSION);
program.parse(process.argv);

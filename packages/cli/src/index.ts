#!/usr/bin/env node

/**
 * dev-workflow CLI
 *
 * AI-driven development workflow system. All commands use Awilix DI
 * for testability and clean architecture.
 */

import { Command } from "commander";

// Import runners from command handler files
import { runInit } from "./commands/init.js";
import { runUpdate } from "./commands/update.js";
import { runUninit } from "./commands/uninit.js";
import { runArchive, runUnarchive, runNuke } from "./commands/archive.js";
import { runUI, runUIInstall, runUIUninstall } from "./commands/ui.js";
import { runWorkers, runClaudeWorker } from "./commands/workers.js";
import { runMCP } from "./commands/mcp.js";
import {
  runBackupCreate,
  runBackupConfigure,
  runBackupSetup,
  runBackupStatus,
  runBackupList,
  runBackupUnconfigure,
  runRestore,
} from "./commands/backup.js";
import { runDatabaseConfigure, runDatabaseStatus } from "./commands/database.js";
import { runCleanClaudeConfig } from "./commands/claude-config.js";

const program = new Command();

program.name("dev-workflow").description("AI-driven development workflow system").version("0.1.0");

program
  .command("init")
  .description("Initialize dev-workflow in current repository")
  .option("--local", "Use local database (./.track/workflow.db) instead of global")
  .option("--url <connection-string>", "Use remote PostgreSQL database")
  .action(async (opts: { local?: boolean; url?: string }) => {
    await runInit({ local: opts.local, url: opts.url });
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
  .command("archive")
  .description("Archive project (uninit + hide from UI) - preserves all data")
  .action(runArchive);

program
  .command("unarchive")
  .description("Restore archived project (reinstalls Claude integration)")
  .action(runUnarchive);

program
  .command("nuke")
  .description("PERMANENTLY DELETE all project data (requires all issues closed)")
  .option("--force", "Force local cleanup when using remote database (remote data preserved)")
  .action(async (options: { force?: boolean }) => {
    await runNuke(options);
  });

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
  .command("board")
  .description("Display a live terminal Kanban board of tasks (refreshes automatically)")
  .option("-i, --interval <seconds>", "Refresh interval in seconds", "3")
  .option("-s, --slugs <slugs>", "Comma-separated list of project slugs to filter")
  .action(async (options: { interval: string; slugs?: string }) => {
    const { runBoard } = await import("./commands/board.js");
    const interval = parseInt(options.interval, 10);
    if (isNaN(interval) || interval < 1) {
      console.error("❌ Interval must be a positive integer");
      process.exit(1);
    }
    await runBoard({ interval, slugs: options.slugs });
  });

// Backup command with subcommands
const backupCmd = program.command("backup").description("Backup and restore workflow database");

backupCmd
  .command("create", { isDefault: true })
  .description("Create a backup of the workflow database")
  .action(runBackupCreate);

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
  .action(
    async (options: {
      bucket: string;
      region: string;
      profile?: string;
      accessKey?: string;
      secretKey?: string;
      endpoint?: string;
      retention?: string;
      createBucket?: boolean;
      validate?: boolean;
    }) => {
      await runBackupConfigure(options);
    }
  );

backupCmd
  .command("setup")
  .description("Interactive setup wizard for backup configuration")
  .action(runBackupSetup);

backupCmd
  .command("status")
  .description("Show current backup configuration")
  .action(runBackupStatus);

backupCmd.command("list").description("List available backups").action(runBackupList);

backupCmd
  .command("unconfigure")
  .description("Remove backup configuration")
  .action(runBackupUnconfigure);

// Restore command (top-level for convenience)
program
  .command("restore [backup]")
  .description("Restore workflow database from a backup")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--no-safety-backup", "Skip creating a safety backup of current database")
  .action(
    async (backup: string | undefined, options: { yes?: boolean; safetyBackup?: boolean }) => {
      await runRestore({ backup, ...options });
    }
  );

// Database command with subcommands
const databaseCmd = program
  .command("database")
  .description("Configure database connection (local SQLite or remote PostgreSQL)");

databaseCmd
  .command("configure")
  .description("Configure database connection")
  .option(
    "--url <connection-string>",
    "PostgreSQL connection URL (e.g., postgresql://user:pass@host/db)"
  )
  .option("--local", "Reset to local SQLite database")
  .action(async (options: { url?: string; local?: boolean }) => {
    await runDatabaseConfigure(options);
  });

databaseCmd
  .command("status")
  .description("Show current database configuration")
  .action(runDatabaseStatus);

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
    await runCleanClaudeConfig(options);
  });

program.parse(process.argv);

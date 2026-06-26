---
sidebar_position: 1
---

# CLI Commands

Complete reference for all dev-workflow CLI commands.

## Overview

| Command | Description |
|---------|-------------|
| `init` | Initialize dev-workflow in a repository |
| `update` | Update skills and run migrations |
| `uninit` | Remove Claude integration |
| `mcp` | Start MCP server |
| `ui` | Start the web UI as a background daemon |
| `ui:stop` | Stop the web UI daemon |
| `ui:status` | Show whether the web UI daemon is running |
| `workers` | List registered workers |
| `claude` | Run as a worker |
| `clean-claude-config` | Clean stale config entries |

## init

Initialize dev-workflow in the current git repository.

```bash
dev-workflow init
```

### What it does

1. Creates `.track/` directory for local storage
2. Initializes SQLite database
3. Installs default templates
4. Installs Claude skills to `.claude/skills/`
5. Registers MCP server in `~/.claude.json`
6. Creates welcome issue #1

### Requirements

- Must be in a git repository
- Must have at least one commit

### Example

```bash
cd my-project
git init
git commit --allow-empty -m "Initial commit"
dev-workflow init
```

## update

Update dev-workflow to the latest version.

```bash
dev-workflow update
```

### What it does

1. Runs database migrations
2. Updates Claude skills to latest version
3. Syncs MCP server registration

### When to use

- After updating the dev-workflow package
- After pulling changes that include migrations
- To refresh skills after manual edits

## uninit

Remove dev-workflow Claude integration from the project.

```bash
dev-workflow uninit
```

### What it removes

- Claude skills from `.claude/skills/`
- MCP server registration from `~/.claude.json`

### What it preserves

- `.track/` directory
- Workflow database
- All issue/task data

### Use case

Temporarily disable dev-workflow without losing data.

## mcp

Start the MCP server for Claude Code integration.

```bash
dev-workflow mcp
```

### How it works

- Starts stdio-based MCP server
- Listens for JSON-RPC messages
- Provides 55 tools for workflow management

### Usage

This command is typically invoked automatically by Claude Code based on the registration in `~/.claude.json`. You rarely need to run it manually.

### Debug mode

For debugging, run in a terminal to see server logs.

## ui

Start the web UI as a background daemon and return to your prompt.

```bash
dev-workflow ui
```

### Options

| Option | Description |
|--------|-------------|
| `--foreground` | Run attached (blocks; Ctrl+C to stop) instead of daemonizing — for debugging |
| `PORT` | Environment variable to set the port (default: 3456) |

### Example

```bash
dev-workflow ui                 # start the daemon (default port)
PORT=3001 dev-workflow ui       # start on a custom port
dev-workflow ui --foreground    # run attached to the terminal
```

### What it does

1. Spawns a detached background process serving the embedded HTTP + WebSocket API and the
   static web UI (no Next.js process, no external dependencies).
2. Saves the port to `~/.track/ui-port` and the PID to `~/.track/ui.pid`; logs to `~/.track/ui.log`.
3. Returns immediately. Re-running `ui` while it's already up just reports the URL.

The daemon runs until stopped or the machine reboots — there is no boot auto-start.

## ui:stop

Stop the running web UI daemon.

```bash
dev-workflow ui:stop
```

## ui:status

Report whether the web UI daemon is running, and on which port.

```bash
dev-workflow ui:status
```

## workers

List registered workers and dispatch queue status.

```bash
dev-workflow workers
```

### Output

- Registered workers with status (IDLE, WORKING, DRAINING)
- Worker session information
- Dispatch queue entries
- Queue statistics

### Use case

Debugging worker issues, checking queue status.

## claude

Run as a Claude worker that polls for and executes dispatched tasks.

```bash
dev-workflow claude [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--name <name>` | Worker name (auto-generates if not provided) |
| `--auto-claim` | Automatically claim READY tasks when dependencies complete |

### Examples

```bash
# Start with auto-generated name
dev-workflow claude

# Start with custom name
dev-workflow claude --name worker-1

# Start with auto-claim enabled
dev-workflow claude --name worker-1 --auto-claim
```

### How it works

1. Registers as a worker in the database
2. Polls dispatch queue for tasks
3. Claims and executes dispatched tasks
4. Reports completion and claims next task

### Lifecycle

1. Worker starts and registers
2. Polls queue every few seconds
3. Claims task when available
4. Spawns Claude session to execute
5. Waits for session to complete
6. Returns to polling

## clean-claude-config

Remove stale worktree folder registrations from `~/.claude.json`.

```bash
dev-workflow clean-claude-config [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be removed without making changes |

### Examples

```bash
# Preview what would be removed
dev-workflow clean-claude-config --dry-run

# Actually clean up
dev-workflow clean-claude-config
```

### What it does

Removes MCP server registrations for worktree directories that no longer exist. This can happen when worktrees are cleaned up but the registration wasn't removed.

## Global Options

### Version

```bash
dev-workflow --version
```

### Help

```bash
dev-workflow --help
dev-workflow <command> --help
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DWF_HOME` | Override the data root (`~/.track`); `TRACK_DIR` is a legacy alias |
| `DWF_PROJECT_SLUG` | Pin the MCP server to a project instead of resolving from cwd |
| `CLAUDE_CONFIG_DIR` | Override Claude's config home (where skills install) |
| `DATABASE_PATH` | Override database path |
| `PORT` | Port for web UI |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error |

## Next Steps

- [MCP Tools Reference](/reference/mcp-tools)
- [Configuration Guide](/reference/configuration)

---
sidebar_position: 1
---

# Installation

This guide covers how to install dev-workflow and its dependencies.

## Prerequisites

Before installing dev-workflow, ensure you have:

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | >= 20.0 | Runtime environment |
| **pnpm** | >= 8.0 | Package manager |
| **Git** | Any recent | Version control |
| **Claude Code** | Latest | AI integration (optional but recommended) |
| **GitHub CLI** | Latest | GitHub sync (optional) |

### Check Prerequisites

```bash
# Check Node.js version
node --version  # Should be >= 20.0

# Check pnpm version
pnpm --version  # Should be >= 8.0

# Check Git
git --version

# Check Claude Code (optional)
claude --version

# Check GitHub CLI (optional)
gh --version
```

## Installation Methods

### npm (Recommended)

Install dev-workflow globally:

```bash
npm install -g @dev-workflow/cli
```

Or with pnpm:

```bash
pnpm add -g @dev-workflow/cli
```

### From Source

Clone and build from source:

```bash
git clone https://github.com/your-org/dev-workflow.git
cd dev-workflow
pnpm install
pnpm build
pnpm link --global
```

## Initialize in a Project

After installation, initialize dev-workflow in your git repository:

```bash
cd your-project
dev-workflow init
```

This will:

1. Create the `.track/` directory for local storage
2. Set up the SQLite database
3. Install Claude skills in `.claude/skills/`
4. Register the MCP server with Claude Code

## Verify Installation

Check that dev-workflow is working:

```bash
# Check version
dev-workflow --version

# Check help
dev-workflow --help

# List workers (should show no workers initially)
dev-workflow workers
```

## Installing Dependencies Automatically

dev-workflow includes a setup command that checks and installs dependencies:

```bash
# Check all dependencies
dev-workflow setup

# Attempt to install missing dependencies
dev-workflow setup --fix
```

## Updating

To update dev-workflow:

```bash
# Update global installation
npm update -g @dev-workflow/cli

# Update in a project
cd your-project
dev-workflow update
```

The `update` command:
- Runs database migrations
- Updates Claude skills to the latest version
- Syncs MCP server registration

## Uninstalling

To remove dev-workflow integration from a project:

```bash
cd your-project
dev-workflow uninit
```

This removes:
- Claude skills from `.claude/`
- MCP server registration

It preserves:
- Your `.track/` directory with all data
- The workflow database

To completely remove, also delete:

```bash
rm -rf .track/
```

## Next Steps

Once installed, continue to the [Quick Start Guide](/getting-started/quick-start) to create your first issue and plan.

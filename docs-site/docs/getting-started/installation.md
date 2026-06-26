---
sidebar_position: 1
---

# Installation

## Quick Install (Recommended)

Run the install script:

```bash
curl -fsSL https://enamrik.github.io/dev-workflow/install.sh | bash
```

This checks prerequisites, installs the CLI, and verifies optional dependencies.

## Manual Installation

### Prerequisites

| Requirement     | Version    | Purpose                   |
| --------------- | ---------- | ------------------------- |
| **Node.js**     | >= 20.0    | Runtime environment       |
| **Git**         | Any recent | Version control           |
| **Claude Code** | Latest     | AI integration (optional) |
| **GitHub CLI**  | Latest     | GitHub sync (optional)    |

### npm Install

```bash
npm install -g @dev-workflow/cli
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

## Check Dependencies

After installing, verify all dependencies are set up correctly:

```bash
dfl setup
```

This checks Node.js, Git, better-sqlite3, Claude CLI, and GitHub CLI. If anything is missing, run with `--fix` to attempt automatic installation:

```bash
dfl setup --fix
```

## Initialize in a Project

After installation, initialize dev-workflow in your git repository:

```bash
cd your-project
dfl init
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
dfl --version

# Check help
dfl --help

# List workers (should show no workers initially)
dfl workers
```

## Updating

To update dev-workflow:

```bash
# Update global installation
npm update -g @dev-workflow/cli

# Update in a project
cd your-project
dfl update
```

The `update` command:

- Runs database migrations
- Updates Claude skills to the latest version
- Syncs MCP server registration

## Uninstalling

To remove dev-workflow integration from a project:

```bash
cd your-project
dfl uninit
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

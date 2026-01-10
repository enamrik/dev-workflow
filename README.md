# dev-workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

AI-driven development workflow system that integrates with Claude Code to automate your development process from issue creation through to production release.

## Features

| Category               | Capabilities                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Issue Tracking**     | Create, update, search, merge issues; soft delete with restore; flexible templates; custom types with GitHub label mapping |
| **Planning**           | Generate implementation plans with tasks; automatic task dependencies; complexity estimation; SPIKE handling for research  |
| **Task Execution**     | 3 execution modes (isolated/branch/main); session ownership; conflict detection; progress logging                          |
| **PR Workflow**        | Create PRs with issue linking; submit for review; automatic status sync; complete after merge                              |
| **GitHub Integration** | Two-way sync with GitHub Issues; GitHub Projects column mapping; import existing issues; sub-issue creation                |
| **Milestones**         | Time-bounded planning; automatic status computation; issue assignment; deadline tracking                                   |
| **Snapshots**          | Version history for issues; time-travel views; revert to previous versions                                                 |
| **Background Workers** | Dispatch queue for parallel execution; worker management; end session handling                                             |
| **Web UI**             | Issues list; Kanban board; worktree management; milestones timeline; workers status; execution logs                        |
| **MCP Tools**          | 55+ tools exposed via Model Context Protocol for Claude Code integration                                                   |
| **Claude Skills**      | 7 skills for natural language workflow automation                                                                          |

## Quick Start

See the **[Quick Start Tutorial](docs/QUICK_START.md)** for a complete walkthrough from project initialization to merged PR.

### Installation

```bash
# Install globally via npm
npm install -g dev-workflow

# Or clone and build from source
git clone https://github.com/enamrik/dev-workflow.git
cd dev-workflow
pnpm install && pnpm build
npm link -w packages/cli
```

### Initialize in Your Project

```bash
cd your-project
dev-workflow init
```

This creates:

- `.track/` - Configuration, templates, and database
- `.claude/skills/` - Claude Code skills for natural language interaction
- MCP server registration in `~/.claude.json` (via `claude mcp add --scope local`)

### Basic Usage

Once initialized, interact with dev-workflow through Claude Code:

```
# Create an issue from natural language
> I want to add user authentication with OAuth

# Work on a task
> Start working on task #1

# Check project status
> Show me the work queue
```

## Documentation

### Getting Started

- **[Quick Start Tutorial](docs/QUICK_START.md)** - End-to-end workflow from issue to merged PR

### Reference

- **[MCP Tools Reference](docs/MCP_TOOLS.md)** - All 55+ tools with parameters and examples
- **[Claude Skills Guide](docs/SKILLS.md)** - 7 skills for natural language automation
- **[CLI Reference](docs/CLI.md)** - Command-line interface documentation

### Workflows

- **[Task Execution Guide](docs/TASK_EXECUTION.md)** - 3 modes, lifecycle, PR workflow
- **[GitHub Integration](docs/GITHUB_INTEGRATION.md)** - Sync, Projects, imports, configuration
- **[Background Workers](docs/WORKERS.md)** - Dispatch queue and parallel execution

### Features

- **[Milestones](docs/MILESTONES.md)** - Time-bounded planning and deadline tracking
- **[Snapshots](docs/SNAPSHOTS.md)** - Version history, time-travel, reversion
- **[Web UI](docs/WEB_UI.md)** - All pages and features

### Configuration

- **[Configuration Guide](docs/CONFIGURATION.md)** - Templates, hooks, types, settings
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

### Architecture

- **[Architecture Overview](docs/ARCHITECTURE.md)** - Domain model and package structure
- **[ADR: Dual-Mode Task Execution](docs/adr/001-dual-mode-task-execution.md)**
- **[ADR: Hook Composition](docs/adr/002-hook-composition.md)**
- **[ADR: Snapshot Versioning](docs/adr/003-snapshot-versioning.md)**

## Project Structure

```
your-project/
├── .claude/
│   ├── skills/dwf-*/         # Claude Code skills
│   └── config/mcp-servers.json
└── .track/
    ├── config.json           # Project settings
    ├── workflow.db           # SQLite database
    ├── templates/
    │   ├── issues/           # Issue templates
    │   └── tasks/            # Task templates
    └── types.md              # Custom type definitions
```

## Development

### Building from Source

```bash
pnpm install
pnpm build
pnpm test
```

### Dogfooding

We use dev-workflow to build dev-workflow. See `make help` for available commands:

```bash
make dogfood    # Full reset + build + init
make test       # Run tests
make prep       # Pre-push validation
```

## License

MIT

## Contributing

1. Create an issue describing your proposed change
2. Fork the repository
3. Create a feature branch
4. Submit a pull request

See [CLAUDE.md](CLAUDE.md) for coding standards and development guidelines.

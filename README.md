# dev-workflow

AI-driven development workflow system that helps automate your development process from issue creation through to production release.

## Features

- **Issue Tracking**: Create and manage issues in a local task tracker
- **Flexible Templates**: Customizable issue templates (feature, bug, enhancement, task)
- **MCP Integration**: Expose tools to Claude Code via Model Context Protocol
- **Claude Skills**: Auto-invoke issue creation from natural language
- **Per-Repository Setup**: Install skills and configuration per repository

## Quick Start

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd dev-workflow

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Initialize in Your Project

Navigate to any repository where you want to use dev-workflow and run:

```bash
# From the dev-workflow directory
node packages/cli/dist/index.js init

# Or link it globally first
cd packages/cli
npm link
cd <your-project>
dev-workflow init
```

This will:
1. Create `.track/` directory with configuration and templates
2. Install skills to `.claude/skills/dev-workflow/`
3. Install subagents to `.claude/agents/dev-workflow/`
4. Register MCP server in `.claude/config/mcp-servers.json`
5. Initialize the task tracker database
6. Create your first issue (#1)

### Directory Structure After Init

```
your-project/
├── .claude/
│   ├── skills/
│   │   └── dev-workflow/
│   │       └── create-issue/
│   │           └── SKILL.md
│   ├── agents/
│   │   └── dev-workflow/
│   │       └── issue-creator/
│   │           └── AGENT.md
│   └── config/
│       └── mcp-servers.json
│
└── .track/
    ├── config.json
    ├── workflow.db
    └── config/
        └── issues/
            └── templates/
                ├── feature.md
                ├── bug.md
                ├── enhancement.md
                └── task.md
```

## Using with Claude Code

Once initialized, you can interact with dev-workflow through Claude Code in several ways:

### 1. Natural Language (via Skill)

The create-issue skill auto-invokes when you mention issue creation:

```
> I want to add user authentication with OAuth
```

Claude will automatically create an issue using the appropriate template.

### 2. Slash Command (Coming Soon)

```
> /issue Add user authentication
```

### 3. Programmatic (via MCP)

Claude Code agents can call MCP tools directly:
- `create_issue` - Create a new issue
- `get_issue` - Get issue by ID or number
- `list_issues` - List issues with filters
- `list_templates` - List available templates

## Issue Templates

Templates are stored in `.track/config/issues/templates/` and can be customized for your project.

### Available Templates

- **feature.md** - For new features and functionality
- **bug.md** - For bug reports and fixes
- **enhancement.md** - For improvements to existing features
- **task.md** - For general tasks and chores

### Template Format

```markdown
---
type: FEATURE
priority: MEDIUM
labels: []
---

# Feature: [Title]

## Description
[Brief description]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Context
[Additional context]
```

The skill will automatically select the appropriate template based on keywords in your description.

## MCP Server

The MCP server runs via stdio transport and exposes tools to Claude Code.

### Start the MCP Server Manually

```bash
node packages/cli/dist/index.js mcp
```

Or use the configured command in `.claude/config/mcp-servers.json`:

```json
{
  "mcpServers": {
    "dev-workflow-tracker": {
      "command": "npx",
      "args": ["dev-workflow", "mcp"],
      "env": {
        "DATABASE_PATH": ".track/workflow.db",
        "TEMPLATES_PATH": ".track/config/issues/templates/"
      }
    }
  }
}
```

## Development

### Project Structure

```
dev-workflow/
├── packages/
│   ├── cli/              # CLI tool (dev-workflow command)
│   │   ├── src/
│   │   ├── templates/    # Bundled templates
│   │   └── skills/       # Bundled skills
│   │
│   └── mcp-server/       # MCP server implementation
│       └── src/
│
├── package.json          # Workspace root
└── pnpm-workspace.yaml
```

### Build

```bash
pnpm build
```

### Development Mode

```bash
pnpm dev
```

### Type Checking

```bash
pnpm typecheck
```

## Dogfooding

We use dev-workflow to build dev-workflow itself. We provide a Makefile for easy setup and management.

### Quick Start with Makefile

```bash
# Show all available commands
make help

# Full setup: reset + install + build + init (recommended for first time)
make dogfood

# Reset and reinitialize
make reset && make init

# Just build
make build

# Clean build artifacts
make clean
```

### Available Make Commands

- `make install` - Install all dependencies
- `make build` - Build all packages
- `make clean` - Clean build artifacts
- `make reset` - Remove `.track/` and `.claude/` directories
- `make init` - Initialize dev-workflow in this repository
- `make dogfood` - Full reset + build + init (start dogfooding)
- `make test` - Run all tests
- `make test-npm-install` - Test npm install scenario (simulates user install)

### Testing npm Install

To ensure `npm install dev-workflow` works the same as local development:

```bash
# Test the npm install scenario
make test-npm-install
```

This script:
1. Packs `@dev-workflow/cli` and `@dev-workflow/mcp-server` into tarballs
2. Creates a temporary directory
3. Installs the packages via `npm install`
4. Runs `dev-workflow init`
5. Verifies the database is created and working

This ensures the installation experience matches what users will get when installing from npm.

### Manual Setup (without Makefile)

```bash
# Build first
pnpm install && pnpm build

# Initialize dev-workflow for this repository
node packages/cli/dist/index.js init

# Now you can create issues for dev-workflow development
```

## Roadmap

- [ ] Phase 1: Issue Creation (Current)
  - [x] Issue templates
  - [x] MCP server with create_issue tool
  - [x] Create-issue skill
  - [ ] Slash command support
  - [ ] Web UI for viewing issues

- [ ] Phase 2: Planning
  - [ ] Generate implementation plans for issues
  - [ ] Break plans into tasks
  - [ ] Version plan history

- [ ] Phase 3: Implementation
  - [ ] Auto-implement tasks with Claude Code agents
  - [ ] Quality gates and code review
  - [ ] Testing integration

- [ ] Phase 4: Integration
  - [ ] GitHub Issues sync
  - [ ] PR creation and management
  - [ ] Deployment tracking (Vercel, etc.)

## License

MIT

## Contributing

We welcome contributions! Please:
1. Create an issue describing what you want to work on
2. Fork the repository
3. Create a feature branch
4. Submit a pull request

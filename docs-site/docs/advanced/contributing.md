---
sidebar_position: 4
---

# Contributing

Guide to contributing to dev-workflow development.

## Development Setup

### Prerequisites

- Node.js >= 20.0
- pnpm >= 8.0
- Git

### Clone and Build

```bash
git clone https://github.com/your-org/dev-workflow.git
cd dev-workflow
pnpm install
pnpm build
```

### Link for Local Development

```bash
make dogfood
```

This:

1. Builds all packages
2. Links CLI globally
3. Initializes dev-workflow in itself
4. Restarts MCP server

## Project Structure

```
apps/
├── cli/              # CLI application
├── mcp-server/       # MCP server (55 tools)
└── web/              # Web UI (Next.js)

packages/
├── tracking/         # Core domain logic
├── database/         # Schema, migrations, repositories
├── git/              # Git operations
├── effect/           # Effect runtime
└── e2e/              # E2E test harness
```

## Development Commands

| Command             | Description                |
| ------------------- | -------------------------- |
| `make dogfood`      | Full rebuild + link + init |
| `make test`         | Run unit tests             |
| `make test-e2e`     | Run E2E tests              |
| `make prep`         | Run all checks before push |
| `make ui-dev-local` | Start UI dev server        |

## Code Standards

### Architectural Principles

1. **Domain-Driven Design** - Rich domain models
2. **SOLID Principles** - Single responsibility, dependency inversion
3. **Clean Architecture** - Layers with clear boundaries
4. **Effect Pattern** - Typed errors, dependency injection

### TypeScript Guidelines

- Strict mode enabled
- No `any` or `@ts-ignore`
- Explicit return types on public methods
- Use branded types for IDs

### Naming Conventions

| Type       | Convention            | Example                 |
| ---------- | --------------------- | ----------------------- |
| Classes    | PascalCase, no `Impl` | `SqliteIssueRepository` |
| Interfaces | PascalCase            | `IssueRepository`       |
| Functions  | camelCase             | `createIssue`           |
| Constants  | UPPER_SNAKE           | `MAX_RETRIES`           |
| Files      | kebab-case            | `issue-service.ts`      |

## Making Changes

### Workflow

1. Create branch from `main`
2. Make changes
3. Run `make prep`
4. Create PR
5. Squash and merge

### Database Changes

When modifying schema:

1. Update **both** schemas:
   - `packages/database/src/schema.ts` (SQLite)
   - `packages/database/src/schema-pg.ts` (PostgreSQL)

2. Generate migration:

   ```bash
   cd packages/database
   pnpm drizzle-kit generate
   ```

3. Update DataSourceProvider if adding tables

### Adding MCP Tools

1. Create handler in `apps/mcp-server/src/tools/`
2. Add schema with Zod
3. Export handler and schema
4. Add to `tools-registry.ts`
5. Add to `tool-definitions.ts`
6. Add tests

### Adding CLI Commands

1. Create command in `apps/cli/src/commands/`
2. Create handler with Effect pattern
3. Add to `main.ts`
4. Add tests

## Testing

### Unit Tests

```bash
pnpm test
```

Test files: `*.test.ts` alongside source

### Integration Tests

```bash
pnpm test:integration
```

Tests database operations, service orchestration

### E2E Tests

```bash
pnpm test:e2e
```

Uses `DirectToolExecutor` for full workflow tests

### AI E2E Tests

```bash
pnpm test:e2e:ai
```

Uses Claude CLI for AI-driven tests (requires API key)

## Pull Request Guidelines

### PR Title

Use conventional commits:

- `feat: Add milestone filtering`
- `fix: Correct task status transition`
- `docs: Update MCP tools reference`
- `refactor: Simplify service layer`

### PR Description

Include:

- Summary of changes
- Related issue numbers
- Test plan
- Breaking changes (if any)

### Review Checklist

- [ ] Follows SOLID principles
- [ ] Uses dependency injection
- [ ] Has appropriate tests
- [ ] Names are clear
- [ ] No code duplication
- [ ] Error handling is explicit
- [ ] TypeScript strict compliant
- [ ] Both schemas updated (if DB change)
- [ ] Mutations go through services
- [ ] Status checks use trait functions

## Documentation

### Updating Docs

Documentation lives in `docs-site/`:

```bash
cd docs-site
pnpm start   # Development server
pnpm build   # Build for production
```

### Skill Updates

After modifying skills in `apps/cli/skills/`:

1. Test locally
2. Review against `scripts/revise-skills.md`
3. Update if needed

## Release Process

### Version Bump

Update version in:

- `package.json` (root)
- `apps/cli/package.json`
- `apps/mcp-server/package.json`

### Creating Release

1. Push to `main`
2. Create GitHub release with tag
3. CI publishes to npm
4. CI deploys docs

## Getting Help

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas
- **Code Review** - Tag maintainers for review

## Code of Conduct

Be respectful, constructive, and inclusive. See [CODE_OF_CONDUCT.md](https://github.com/your-org/dev-workflow/blob/main/CODE_OF_CONDUCT.md).

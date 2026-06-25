---
sidebar_position: 1
---

# Architecture

Overview of dev-workflow's system architecture.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code / CLI                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MCP Protocol (JSON-RPC over stdio)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MCP Server                                  │
│                   (55 Tools for Workflow)                        │
├─────────────────────────────────────────────────────────────────┤
│                    Application Services                          │
│         (IssueService, TaskService, PlanningService)            │
├─────────────────────────────────────────────────────────────────┤
│                     Domain Layer                                 │
│              (Entities, Value Objects, Traits)                   │
├─────────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                           │
│           (Repositories, External Providers)                     │
└──────┬────────────────────────────────────┬─────────────────────┘
       │                                    │
       ▼                                    ▼
┌──────────────┐                    ┌──────────────────┐
│   SQLite DB  │                    │   GitHub API     │
│  (Drizzle)   │                    │   (gh CLI)       │
└──────────────┘                    └──────────────────┘
```

## Package Structure

```
apps/
├── cli/                    # CLI commands (Commander.js)
├── mcp-server/             # MCP server (55 tools)
└── web/                    # Web UI (Next.js)

packages/
├── tracking/               # Core domain: issues, plans, tasks
├── database/               # Database: schema, migrations, repositories
├── git/                    # Git: worktrees, branches
├── effect/                 # Effect runtime utilities
└── e2e/                    # E2E test harness
```

## Core Principles

### Domain-Driven Design

- **Rich Domain Models** - Business logic in entities
- **Ubiquitous Language** - Issue, Plan, Task, not Record, Item
- **Bounded Contexts** - tracking, database, git

### SOLID Principles

- **Single Responsibility** - Each class has one reason to change
- **Open/Closed** - Extend via interfaces, not modification
- **Dependency Inversion** - Depend on abstractions

### Dependency Injection

All dependencies are injected via constructor:

```typescript
class TaskService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly provider: ProjectManagementProvider | null
  ) {}
}
```

## Data Flow

### MCP Tool Call

```
Claude → MCP Server → Handler → Service → Repository → Database
                                  ↓
                            Provider (GitHub)
```

### Request Lifecycle

1. **MCP Server** receives JSON-RPC request
2. **Tool Registry** routes to handler
3. **Handler** validates input, yields Effect
4. **Service** orchestrates business logic
5. **Repository** executes database operations
6. **Provider** syncs to external systems
7. **Response** returned via MCP protocol

## Database Layer

### DataSourceProvider

Abstracts database operations for multiple backends:

```typescript
interface DataSourceProvider {
  readonly providerId: string;  // "sqlite" or "neon"

  getDb(): DrizzleDatabase;

  // Repository factories
  createIssueRepository(projectId: string): IssueRepository;
  createPlanRepository(projectId: string): PlanRepository;
  createTaskRepository(projectId: string): TaskRepository;
  // ...
}
```

### Schema

Two schemas maintained in parallel:
- `schema.ts` - SQLite (CLI/MCP)
- `schema-pg.ts` - PostgreSQL (Web/Neon)

### Migrations

Drizzle Kit generates migrations:

```bash
cd packages/database
pnpm drizzle-kit generate
```

## Service Layer

Services orchestrate multi-step flows:

```typescript
class IssueService {
  async closeIssue(issueId: string): Promise<Issue> {
    // 1. Validate state
    // 2. Abandon remaining tasks (via TaskService)
    // 3. Sync to GitHub (via Provider)
    // 4. Update database
    // 5. Create snapshot
  }
}
```

Key services:
- `IssueService` - Issue lifecycle
- `TaskService` - Task execution
- `PlanningService` - Plan generation
- `MilestoneService` - Milestone management

## Effect Pattern

Handlers return Effect for structured error handling:

```typescript
export const handleCreateIssue = createMcpHandler({
  schema: CreateIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* createIssue({ ...args, projectSlug }));
    }),
});
```

## External Integration

### ProjectManagementProvider

Abstracts external systems (GitHub, Jira, etc.):

```typescript
interface ProjectManagementProvider {
  readonly providerId: string;

  createIssue(params: CreateIssueParams): Promise<ExternalIssue>;
  closeIssue(issueRef: string): Promise<void>;
  addToProject(issueNodeId: string, projectId: string): Promise<ProjectItemResult>;
  moveToColumn(itemId: string, projectId: string, columnName: string): Promise<void>;
}
```

### GitHub Integration

```
TaskService → GitHubProjectManagementProvider → GitHub CLI → GitHub API
```

## Git Integration

### Worktree Management

Tasks execute in isolated worktrees:

```
~/.track/{project}/worktrees/issue-{N}-task-{T}/
  └── Complete git working directory
```

### Branch Naming

```
issue-{issueNumber}/task-{taskNumber}-{slug}
```

## Web UI

### Architecture

```
Next.js App Router
    ↓
API Routes (Effect handlers)
    ↓
Domain Services
    ↓
SQLite/PostgreSQL
```

### Multi-Project Support

Web UI shows all projects in the track directory, each with its own context.

## Testing Strategy

| Level | Focus | Tools |
|-------|-------|-------|
| Unit | Domain logic | Vitest |
| Integration | Database, services | Vitest + SQLite |
| E2E | Full workflows | DirectToolExecutor |
| AI E2E | Claude interaction | Claude CLI |

## Performance

### Database

- SQLite for local operations
- WAL mode for concurrency
- Indexes on common queries

### MCP Server

- Single process per project
- Tool handlers are stateless
- Repository pattern for efficient queries

## Security

- No credentials in database
- GitHub auth via `gh` CLI
- Worktrees are sandboxed

## Next Steps

- [Background Workers](/advanced/workers)
- [Troubleshooting](/advanced/troubleshooting)
- [Contributing](/advanced/contributing)

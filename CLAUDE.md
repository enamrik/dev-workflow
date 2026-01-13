# Coding Standards for dev-workflow

This document defines the coding standards and architectural principles for the dev-workflow project.

## Core Principles

### 1. Object-Oriented Programming (OOP)

- Use classes to encapsulate behavior and state
- Favor composition over inheritance
- Encapsulate what varies

### 2. SOLID Principles

#### Single Responsibility Principle (SRP)

- Each class should have one, and only one, reason to change
- Example: `FileSystem` handles file operations, `ConfigManager` handles configuration

#### Open/Closed Principle (OCP)

- Classes should be open for extension but closed for modification
- Use interfaces and abstract classes for extensibility

#### Liskov Substitution Principle (LSP)

- Subtypes must be substitutable for their base types
- Interfaces should define contracts that implementations honor

#### Interface Segregation Principle (ISP)

- No client should be forced to depend on methods it does not use
- Create focused, specific interfaces

#### Dependency Inversion Principle (DIP)

- Depend on abstractions, not concretions
- Use dependency injection for all dependencies

### 3. Domain-Driven Design (DDD)

#### Rich Domain Models

- Business logic belongs in domain entities
- Entities should be self-validating
- Use value objects for concepts without identity

Example:

```typescript
class Issue {
  private constructor(
    public readonly id: IssueId,
    public readonly number: IssueNumber,
    private _title: Title,
    private _status: IssueStatus
  ) {}

  static create(title: string): Issue {
    return new Issue(IssueId.generate(), IssueNumber.next(), Title.create(title), IssueStatus.Open);
  }

  close(): void {
    if (this._status === IssueStatus.Closed) {
      throw new Error("Issue is already closed");
    }
    this._status = IssueStatus.Closed;
  }
}
```

#### Ubiquitous Language

- Use the same terminology in code as the business domain
- Example: `Issue`, `Plan`, `Task`, not `Record`, `Item`, `Thing`

#### Bounded Contexts

- Separate concerns into clear boundaries
- Example: `issue-tracking`, `planning`, `github-integration`

### 4. Dependency Injection

#### Constructor Injection (Preferred)

```typescript
class IssueService {
  constructor(
    private readonly repository: IssueRepository,
    private readonly eventBus: EventBus
  ) {}
}
```

#### Interface-based Dependencies

```typescript
interface IssueRepository {
  save(issue: Issue): Promise<void>;
  findById(id: IssueId): Promise<Issue | null>;
}

class SqliteIssueRepository implements IssueRepository {
  // Implementation
}
```

#### External Integration Abstraction (ProjectManagementProvider)

For external project management systems (GitHub, Jira, Linear, etc.), use the `ProjectManagementProvider` interface:

```typescript
// Domain interface - packages/core/src/domain/project-management-provider.ts
interface ProjectManagementProvider {
  readonly providerId: string; // "github", "jira", "linear"
  readonly displayName: string;

  // Issue operations
  createIssue(params: CreateIssueParams): Promise<ExternalIssue>;
  closeIssue(issueRef: string): Promise<void>;

  // Project board operations
  addToProject(issueNodeId: string, projectId: string): Promise<ProjectItemResult>;
  moveToColumn(itemId: string, projectId: string, columnName: string): Promise<void>;
}

// Implementation - packages/core/src/infrastructure/providers/
class GitHubProjectManagementProvider implements ProjectManagementProvider {
  // Wraps GitHubCLI for GitHub-specific operations
}
```

**Key rules:**

- Application services (e.g., `TaskSyncService`) depend on `ProjectManagementProvider`, not GitHub-specific code
- Never call GitHub CLI directly from application layer - always go through the provider
- The provider handles all external API calls and error translation

#### ⚠️ CRITICAL: Database Abstraction (DataSourceProvider)

**This is the most important abstraction in the codebase. NEVER bypass it.**

The `DataSourceProvider` interface (`packages/core/src/domain/data-source.ts`) abstracts database operations to support multiple backends (SQLite for CLI/MCP, PostgreSQL/Neon for web). **ALL repositories MUST be created through this interface.**

```typescript
// Domain interface - packages/core/src/domain/data-source.ts
interface DataSourceProvider {
  readonly providerId: string; // "sqlite", "neon"

  getDb(): DrizzleDatabase;

  // Repository factory methods - ALL repositories go here
  getProjectRepository(): ProjectRepository;
  createIssueRepository(projectId: string): IssueRepository;
  createPlanRepository(projectId: string): PlanRepository;
  createTaskRepository(projectId: string): TaskRepository;
  createMilestoneRepository(projectId: string): MilestoneRepository;
  createSnapshotRepository(projectId: string): SnapshotRepository;
  // Add new repositories here...
}

// Implementations:
// - SqliteDataSource (packages/core/src/infrastructure/database/sqlite-data-source.ts)
// - NeonDataSource (packages/core/src/infrastructure/database/neon-data-source.ts)
```

**⚠️ When adding a new table or repository, you MUST:**

1. **Update BOTH schemas** - `schema.ts` (SQLite) AND `schema-pg.ts` (PostgreSQL)
2. **Define the repository interface** in `domain/` (e.g., `domain/type.ts`)
3. **Add factory method** to `DataSourceProvider` interface
4. **Implement in BOTH** `SqliteDataSource` AND `NeonDataSource`
5. **Use `DrizzleDatabase`** type (not `SqliteDrizzleDatabase`) for dialect-agnostic queries

**❌ NEVER DO THIS:**

```typescript
// BAD - Bypasses DataSourceProvider, only works with SQLite
class SqliteTypeRepository {
  constructor(private readonly db: SqliteDrizzleDatabase) {} // WRONG TYPE
}

// BAD - Creating repository directly instead of through DataSourceProvider
const repo = new SqliteTypeRepository(db);
```

**✅ ALWAYS DO THIS:**

```typescript
// GOOD - Repository uses dialect-agnostic type
class SqliteTypeRepository implements TypeRepository {
  constructor(private readonly db: DrizzleDatabase) {}
}

// GOOD - Get repository through DataSourceProvider
const repo = dataSource.createTypeRepository(projectId);
```

**⚠️ Factory Pattern - Creating Data Sources:**

Always use `DataSourceFactory.create()` - never `createSqlite()` or `createNeon()` directly:

```typescript
// ❌ BAD - Bypasses factory abstraction
if (DataSourceFactory.isRemote(connectionString)) {
  throw new Error("Remote not supported");
}
const db = await DataSourceFactory.createSqlite(connectionString);

// ✅ GOOD - Use factory method, check property after creation
const dataSource = await DataSourceFactory.create({ connectionString });
if (dataSource.isRemote) {
  dataSource.close();
  throw new Error("Remote not supported yet");
}
```

**Why this matters:** The web UI uses PostgreSQL (Neon), while CLI/MCP use SQLite. Breaking this abstraction means features work in one environment but fail silently in another.

### 5. Clean Code Practices

#### Naming

- Use descriptive, intention-revealing names
- Avoid abbreviations unless universally understood
- Classes: nouns (User, Issue, Plan)
- Methods: verbs (create, update, delete)
- Booleans: is/has/can prefix (isOpen, hasChildren, canClose)

#### Functions

- Keep functions small (< 20 lines ideally)
- One level of abstraction per function
- Minimize parameters (< 3 ideally)
- No side effects in query methods

#### Comments

- Code should be self-documenting
- Use comments for "why", not "what"
- Document complex business rules
- Keep comments up to date or delete them

#### Error Handling

- Use custom error classes for domain errors
- Don't return null - use Option/Maybe pattern or throw
- Fail fast - validate at boundaries

```typescript
class IssueNotFoundError extends Error {
  constructor(public readonly issueId: IssueId) {
    super(`Issue not found: ${issueId.value}`);
    this.name = "IssueNotFoundError";
  }
}
```

## Project Structure

```
packages/
├── cli/
│   ├── src/
│   │   ├── commands/          # CLI command implementations
│   │   ├── infrastructure/    # External concerns (file system, config)
│   │   └── application/       # Application services (orchestration)
│
├── core/
│   ├── src/
│   │   ├── domain/            # Domain entities, value objects
│   │   │   ├── issue/
│   │   │   ├── plan/
│   │   │   └── task/
│   │   ├── application/       # Use cases, application services
│   │   └── infrastructure/    # Repository implementations
│
└── mcp-server/
    └── src/
        ├── tools/             # MCP tool implementations
        └── application/       # Application layer for MCP
```

## Testing Standards

### Unit Tests

- Test behavior, not implementation
- Use mocks for dependencies
- One assertion per test (when possible)
- Follow AAA pattern: Arrange, Act, Assert

```typescript
describe("Issue", () => {
  it("should close an open issue", () => {
    // Arrange
    const issue = Issue.create("Test issue");

    // Act
    issue.close();

    // Assert
    expect(issue.status).toBe(IssueStatus.Closed);
  });

  it("should throw when closing an already closed issue", () => {
    // Arrange
    const issue = Issue.create("Test issue");
    issue.close();

    // Act & Assert
    expect(() => issue.close()).toThrow("Issue is already closed");
  });
});
```

### Integration Tests

- Test complete workflows
- Use real implementations where possible
- Clean up after tests (database, files)

## Development Commands

Useful Make commands for development:

```bash
make dogfood            # Full reset + build + link + init
make test               # Run unit tests
make test-e2e           # Run E2E tests (requires Claude CLI)
make prep               # Run all checks before pushing (REQUIRED before push)
make ui-dev-local       # Start UI dev server with local test data
```

### MCP Server Auto-Restart

`make dogfood` automatically kills the running MCP server process after rebuilding. Claude Code will restart it on the next MCP tool call, loading the fresh code.

If you rebuild packages manually (e.g., `pnpm build`), you can restart the MCP server by:

- Running `pkill -f "dev-workflow.*mcp"` in terminal, OR
- Running `/mcp` in Claude Code

**Note**: CLI commands like `dev-workflow update` do NOT have stale code issues - they start fresh each invocation.

### Task Completion Cleanup

After completing a task via the `dwf-work-task` skill (PR merged and worktree cleaned up), run:

```bash
git fetch --prune
```

This removes local references to remote branches that have been deleted on GitHub, keeping the local repository clean of stale `origin/*` references.

### Git Workflow

**IMPORTANT: Never create merge commits on any branch.**

- Always use **squash and merge** (or **rebase and merge**) when merging PRs on GitHub
- Never use the "Create a merge commit" option
- Never run `git merge` locally without `--ff-only` flag
- If you need to update a branch from main, use `git rebase main` instead of `git merge main`

This keeps the commit history linear and clean. Each PR should result in a single commit on main.

### Pre-Push Validation

**IMPORTANT: Always run `make prep` before pushing to remote (PR or main branch).**

This command runs all validation checks in order with fail-fast behavior:

1. Type checking (`pnpm typecheck`)
2. Linting (`pnpm lint`)
3. Format checking (`pnpm format:check`)
4. Unit tests (`pnpm test`)
5. Integration tests (`pnpm test:integration`)
6. E2E tests (`pnpm test:e2e`)

### Working in Worktrees

When working on UI changes in an isolated worktree (via `start_task_session` with `mode: "isolated"`), always run the dev server to let the user verify changes:

```bash
make ui-dev-local
```

This command:

1. Installs dependencies if needed (`make worktree-setup`)
2. Creates a local `.track/` directory with test data
3. **Detects if running in a worktree** and calculates a unique port using both issue and task numbers
4. Starts the Next.js dev server and opens browser with issue filter querystring

**Port formula:** `3500 + (issue % 50) + (task * 50)`

This gives each issue 50 ports (tasks 0-49) and ensures different tasks from the same issue get different ports.

For example, in worktree `issue-54-task-1`:

- Port: 3554 (3500 + 54 % 50 + 1 \* 50 = 3500 + 4 + 50)
- URL: http://localhost:3554/?issue=54

And in worktree `issue-54-task-2`:

- Port: 3604 (3500 + 54 % 50 + 2 \* 50 = 3500 + 4 + 100)
- URL: http://localhost:3604/?issue=54

---

## ⚠️ IMPORTANT: Verification Workflow

**After completing ANY code changes, you MUST ask the user:**

> "Would you like me to run `make ui-dev-local` so you can verify the changes?"

**Do NOT submit for review until the user has had the opportunity to verify the changes.**

---

### Database Migrations

**IMPORTANT: NEVER delete `~/.track/workflow.db`!** This file contains all issue tracking data.

When making schema changes:

1. **Update BOTH schemas:**
   - `packages/core/src/infrastructure/database/schema.ts` (SQLite)
   - `packages/core/src/infrastructure/database/schema-pg.ts` (PostgreSQL)
2. Run `pnpm drizzle-kit generate` in `packages/core` to create an incremental migration
3. Run `dev-workflow update` to apply the migration
4. **If adding a new table:** Follow the DataSourceProvider checklist above (add repository interface, factory method, implement in both data sources)

The generated migration will contain only the changes (ALTER TABLE statements), preserving existing data.

**⚠️ Forgetting to update `schema-pg.ts` will break the web UI silently.**

## TypeScript Guidelines

### Type Safety

#### Never Use `any` or Type Assertions to Escape Type System

- **NEVER** use `as any` to bypass type checking
- **NEVER** use `@ts-ignore` or `@ts-expect-error` comments
- If the type system is complaining, fix the types - don't silence it
- Type assertions (`as Type`) should be rare and well-justified

**Bad:**

```typescript
// ❌ NEVER DO THIS
await (this.fileSystem as any).copyDirectory(source, dest);

// ❌ NEVER DO THIS
// @ts-ignore
const result = unsafeOperation();
```

**Good:**

```typescript
// ✅ Add the method to the interface
interface FileSystem {
  copyDirectory(source: string, destination: string): Promise<void>;
}

// ✅ Now type-safe usage works
await this.fileSystem.copyDirectory(source, dest);
```

#### General Type Safety Rules

- Avoid `any` - use `unknown` if type is truly unknown
- Use strict mode with all strict flags enabled
- Define explicit return types for public methods
- Use branded types for domain IDs to prevent confusion

```typescript
type IssueId = string & { readonly __brand: "IssueId" };

class IssueId {
  private constructor(private readonly value: string) {}

  static create(value: string): IssueId {
    if (!value) throw new Error("IssueId cannot be empty");
    return value as IssueId; // Only acceptable use of 'as' - for branded types
  }

  toString(): string {
    return this.value;
  }
}
```

#### TypeScript Configuration

Our `tsconfig.json` enforces maximum type safety:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Immutability

- Prefer `readonly` for properties
- Use `const` for variables
- Return new objects instead of mutating

### Async/Await

- Always use async/await over callbacks
- Handle errors explicitly
- Don't mix promises and async/await

## Anti-Patterns to Avoid

❌ **Type System Escape Hatches** - `as any`, `@ts-ignore`, unnecessary type assertions
❌ **Anemic Domain Models** - entities with only getters/setters
❌ **God Classes** - classes that do too much
❌ **Magic Numbers** - use named constants
❌ **Deep Nesting** - extract to methods
❌ **Long Parameter Lists** - use parameter objects
❌ **Primitive Obsession** - use value objects
❌ **Feature Envy** - method uses another class more than its own
❌ **Shotgun Surgery** - one change requires many file edits
❌ **Global Mutable State** - singletons, module-level `let instance = null` patterns
❌ **Wrapper Modules** - modules with many unrelated exported functions (god modules)
❌ **Bypassing DataSourceProvider** - creating repositories directly instead of through factory methods, using `SqliteDrizzleDatabase` instead of `DrizzleDatabase`, only updating one schema
❌ **Bypassing DataSourceFactory** - calling `createSqlite()` or `createNeon()` directly, checking `isRemote()` before creating data source
❌ **Bypassing Service Layer** - calling repository mutations directly from MCP tools, API routes, or CLI instead of through services
❌ **Duplicated Logic Across Services** - implementing the same operation in multiple services instead of one service calling another
❌ **Scattered Status Identity Checks** - checking `status === "COMPLETED" || status === "ABANDONED"` instead of using trait functions like `isTerminal(task)`. Status semantics are defined in `packages/core/src/domain/task.ts` via `STATUS_TRAITS`. Use `isTerminal()`, `isWorkable()`, `isActive()` for all status queries.

## Dependency Injection Patterns

### God Classes and Global State

❌ **Never create wrapper classes/modules with many unrelated methods:**

```typescript
// BAD - God class / god module
class DataService {
  listIssues() {}
  listTasks() {}
  getWorkers() {}
  pruneWorktrees() {}
}

// Also BAD - God module with exported functions
export function listIssues() {}
export function listTasks() {}
export function getWorkers() {}
```

✅ **Use focused repository/service classes with constructor injection:**

```typescript
// GOOD - Single responsibility
class IssueRepository {
  constructor(private readonly db: DrizzleDatabase) {}
  findMany() {}
}

class TaskRepository {
  constructor(private readonly db: DrizzleDatabase) {}
  findByPlanId(planId: string) {}
}
```

❌ **Never use global mutable state for dependencies:**

```typescript
// BAD - Global singleton with mutable state
let instance: Service | null = null;
export function getInstance() {
  if (!instance) instance = new Service();
  return instance;
}

// Also BAD - Module-level connection caching
let registry: DataSourceRegistry | null = null;
```

### Per-Package DIContext Pattern

For long-running servers (web, mcp-server), use a DIContext class per package:

```typescript
// packages/web/src/lib/di-context.ts
export class WebDIContext {
  readonly issueRepository: IssueRepository;
  readonly planRepository: PlanRepository;
  readonly issueStatusService: IssueStatusService;

  private constructor(db: DrizzleDatabase, projectId: string) {
    this.issueRepository = new SqliteIssueRepository(db, projectId);
    this.planRepository = new SqlitePlanRepository(db);
    this.issueStatusService = new IssueStatusService(
      this.planRepository,
      new SqliteTaskRepository(db)
    );
  }

  static async create(projectSlug: string): Promise<WebDIContext> {
    const registry = new DataSourceRegistry();
    const dataSource = await registry.getDataSource(projectSlug);
    // ... resolve projectId, create instance
  }
}
```

Usage in route handlers:

```typescript
// Each request creates its own context (no shared state)
export async function GET(request: NextRequest) {
  const registry = new DataSourceRegistry();
  const { projects } = await registry.getSourcesWithProjects();

  for (const project of projects) {
    const context = await WebDIContext.createFromProjectInfo(project, registry);
    const issues = context.issueRepository.findMany({});
  }
}
```

For CLI commands, create dependencies locally within each command function:

```typescript
// CLI commands are short-lived - no DIContext needed
async function runInit(options: InitOptions): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const resolver = createTrackDirectoryResolver(workingDirectory);
  const installer = new InstallService(fileSystem, workingDirectory, resolver);
  // ... use installer
}
```

### Repository Pattern

- Repositories take `DrizzleDatabase` via constructor injection
- Repositories are stateless (no caching of query results)
- Each request/command creates its own repository instances
- Same repository classes used across web, MCP, and CLI
- **Repositories are for data access only** - they should NOT be called directly for mutations from MCP tools, API routes, or CLI commands

### ⚠️ CRITICAL: Service Layer Pattern (Orchestration)

**Services orchestrate multi-step flows.** They wrap repositories, external providers, and call other services to provide atomic, reusable operations. Presentation layers (MCP tools, API routes, CLI) call services - never repositories directly for mutations.

```
┌─────────────────────────────────────────────────────────────────┐
│  MCP Tools / API Routes / CLI Commands                          │
│  (Presentation Layer - NO direct repository mutations)          │
└─────────────────────────────┬───────────────────────────────────┘
                              │ calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Services (Application Layer)                                   │
│  IssueService, TaskService, MilestoneService, etc.              │
│  - Orchestrates multi-step operations                           │
│  - Uses multiple repositories                                   │
│  - Calls other services (to avoid duplicating logic)            │
│  - Integrates with external providers (GitHub sync)             │
└──────┬────────────────┬────────────────────────┬────────────────┘
       │                │                        │
       ▼                ▼                        ▼
┌────────────┐   ┌────────────┐   ┌──────────────────────────────┐
│ Repository │   │ Other      │   │  ProjectManagementProvider   │
│            │   │ Services   │   │  (External Integration)      │
└────────────┘   └────────────┘   └──────────────────────────────┘
```

**Key Principles:**

1. **Services orchestrate flows** - Multi-step operations belong in services
2. **Services can call other services** - To avoid duplicating logic across services
3. **Rich domain models for shared behavior** - Intrinsic entity behavior goes in the domain model
4. **Repositories are data access only** - No business logic, no orchestration

**Service Calling Service (Avoiding Duplication):**

```typescript
// IssueService calls TaskService - avoids duplicating abandon logic
class IssueService {
  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly taskService: TaskService, // Service, not repository!
    private readonly planRepository: PlanRepository,
    private readonly provider: ProjectManagementProvider | null
  ) {}

  async closeIssue(issueId: string): Promise<Issue> {
    const issue = this.issueRepository.findById(issueId);
    if (!issue) throw new IssueNotFoundError(issueId);

    // 1. Use TaskService for task operations (reuse, don't duplicate)
    const plan = this.planRepository.findByIssueId(issueId);
    if (plan) {
      const tasks = this.taskRepository.findByPlanId(plan.id);
      for (const task of tasks) {
        if (!task.isTerminal()) {
          await this.taskService.abandonTask(task.id); // Calls TaskService!
        }
      }
    }

    // 2. Sync to external provider FIRST (atomicity)
    if (this.provider && issue.githubSync?.githubIssueNumber) {
      await this.provider.closeIssue(String(issue.githubSync.githubIssueNumber));
    }

    // 3. Update local database
    return this.issueRepository.update(issueId, { status: "CLOSED" });
  }
}
```

**Rich Domain Model (Shared Behavior in Entity):**

```typescript
// When behavior is intrinsic to the entity, put it in the domain model
class Task {
  isTerminal(): boolean {
    return ["COMPLETED", "ABANDONED"].includes(this.status);
  }

  canTransitionTo(newStatus: TaskStatus): boolean {
    const allowed = VALID_TRANSITIONS[this.status];
    return allowed?.includes(newStatus) ?? false;
  }
}

// Service uses domain model behavior
class TaskService {
  async updateStatus(taskId: string, newStatus: TaskStatus): Promise<Task> {
    const task = this.taskRepository.findById(taskId);
    if (!task.canTransitionTo(newStatus)) {
      throw new InvalidTransitionError(task.status, newStatus);
    }
    // ... proceed with update and sync
  }
}
```

**❌ NEVER DO THIS:**

```typescript
// BAD - Direct repository mutation from presentation layer
async function handleCloseIssue(issueNumber: number) {
  issueRepository.update(issue.id, { status: "CLOSED" });  // Bypasses service!
}

// BAD - Duplicating logic across services (should call TaskService instead)
class IssueService {
  closeIssue(id: string) {
    // Duplicates TaskService.abandonTask logic
    this.taskRepository.update(taskId, { status: "ABANDONED", abandonedAt: now });
    if (this.provider) await this.provider.updateTask(...);
  }
}
```

**✅ ALWAYS DO THIS:**

```typescript
// GOOD - Presentation calls service
async function handleCloseIssue(issueNumber: number) {
  await issueService.closeIssue(issue.id);
}

// GOOD - Service calls service to reuse logic
class IssueService {
  async closeIssue(id: string) {
    for (const task of tasks) {
      await this.taskService.abandonTask(task.id); // Reuse, don't duplicate
    }
  }
}
```

**Required Services:**

| Entity    | Service            | Responsibilities                                                   |
| --------- | ------------------ | ------------------------------------------------------------------ |
| Issue     | `IssueService`     | create, update, close (calls TaskService), delete, assignMilestone |
| Task      | `TaskService`      | create, update, updateStatus, abandon, complete, submitForReview   |
| Milestone | `MilestoneService` | create, update, delete                                             |
| Plan      | `PlanningService`  | generate, regenerate (already exists)                              |

**Service Location:** `packages/core/src/application/{entity}-service.ts`

**DI Context Updates:** Both `McpDIContext` and `WebDIContext` must expose services for mutations.

### Soft Delete Convention

**Tables with soft delete**: `issues`, `tasks` (have `isDeleted`, `deletedAt`, `deletedBy` columns)

**CRITICAL**: All repository query methods MUST filter out soft-deleted records by default.

Pattern to follow:

```typescript
// ✅ CORRECT - filters deleted by default, opt-in to include
findById(id: string, includeDeleted = false): Entity | null {
  const conditions = [eq(table.id, id)];
  if (!includeDeleted) {
    conditions.push(eq(table.isDeleted, false));
  }
  return this.db.select().from(table).where(and(...conditions)).get();
}

// ✅ CORRECT - for methods that MUST include deleted (e.g., immutable numbering)
getNextTaskNumber(planId: string): number {
  // Includes deleted - task numbers are immutable
  // ... query without isDeleted filter
}
```

**Exception**: Methods like `getNextTaskNumber()` that need deleted records for immutability should NOT filter, and should have a comment explaining why.

### TaskStatus Traits (Table-Driven Methods)

**Location**: `packages/core/src/domain/task.ts`

Status semantics are centralized in `STATUS_TRAITS`. **NEVER** check status identities directly:

```typescript
// ❌ BAD - Scattered identity checks, breaks when new status added
const terminal = tasks.filter((t) => t.status === "COMPLETED" || t.status === "ABANDONED");
const active = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "PR_REVIEW");

// ✅ GOOD - Use trait functions (single source of truth)
import { isTerminal, isActive } from "@dev-workflow/core";
const terminal = tasks.filter(isTerminal);
const active = tasks.filter(isActive);
```

**Available trait functions:**

| Function           | Returns true for            | Use case                   |
| ------------------ | --------------------------- | -------------------------- |
| `isTerminal(task)` | COMPLETED, ABANDONED        | Progress counts, "is done" |
| `isWorkable(task)` | BACKLOG, READY, IN_PROGRESS | "Can be worked on"         |
| `isActive(task)`   | IN_PROGRESS, PR_REVIEW      | "Work in progress"         |

**TypeScript enforces exhaustiveness**: Adding a new status requires adding it to `STATUS_TRAITS` or the build fails.

### IssueStatus Traits (Table-Driven Methods)

**Location**: `packages/core/src/domain/issue.ts`

Issue status semantics are centralized in `ISSUE_STATUS_TRAITS` and `COMPUTED_ISSUE_STATUS_TRAITS`. **NEVER** check status identities directly:

```typescript
// ❌ BAD - Scattered identity checks
const closed = issues.filter((i) => i.status === "CLOSED");
const active = issues.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS");

// ✅ GOOD - Use trait functions (single source of truth)
import { isIssueClosed, isIssueInPlanning } from "@dev-workflow/core";
const closed = issues.filter(isIssueClosed);
const active = issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i));
```

**Stored status trait functions** (check the stored issue.status):

| Function                   | Returns true for | Use case            |
| -------------------------- | ---------------- | ------------------- |
| `isIssueInPlanning(issue)` | PLANNED          | "Not yet activated" |
| `isIssueClosed(issue)`     | CLOSED           | "Issue is done"     |

**Computed status trait functions** (require tasks to compute):

| Function                           | Returns true for               | Use case            |
| ---------------------------------- | ------------------------------ | ------------------- |
| `isIssueDone(issue, tasks)`        | CLOSED or all tasks terminal   | "All work complete" |
| `issueHasActiveWork(issue, tasks)` | Any task IN_PROGRESS/PR_REVIEW | "Work in progress"  |

**Helper functions for task aggregation:**

| Function                  | Returns true when              | Use case                |
| ------------------------- | ------------------------------ | ----------------------- |
| `allTasksTerminal(tasks)` | All tasks COMPLETED/ABANDONED  | Check if issue is done  |
| `anyTaskActive(tasks)`    | Any task IN_PROGRESS/PR_REVIEW | Check if work is active |

**Design principle**: The trait-based approach hides whether status is computed or stored. The ONE place to change when switching implementations is `getEffectiveIssueStatus()` (private function).

## Code Review Checklist

- [ ] Follows SOLID principles
- [ ] Uses dependency injection
- [ ] Has appropriate unit tests
- [ ] Names are clear and descriptive
- [ ] No code duplication
- [ ] Error handling is explicit
- [ ] No magic numbers or strings
- [ ] Business logic in domain layer
- [ ] Infrastructure concerns separated
- [ ] TypeScript strict mode compliant
- [ ] **New tables/repositories follow DataSourceProvider pattern** (both schemas, factory methods, both implementations)
- [ ] **Mutations go through services** (not direct repository calls from MCP/API/CLI)
- [ ] **Services call services** (not duplicating logic - one service delegates to another)
- [ ] **Status checks use trait functions** (use `isTerminal()`, `isActive()` - not direct `status === "COMPLETED"` checks)

## Testing GitHub Sync

If you suspect GitHub sync issues (e.g., project column not updating after `submit_for_review`), run the test workflow:

```
Read scripts/test-workflow.md and execute the test workflow
```

This script tests the full issue lifecycle with verification steps using `gh api graphql` and `sqlite3` queries.

## Claude Code Skills

These guide Claude's behavior during conversations. Claude decides when to activate them.

- **Location**: `.claude/skills/dwf-*/SKILL.md`
- **Source**: `packages/cli/skills/dwf-*/SKILL.md`
- **Discovery**: Auto-discovered by Claude Code at startup via semantic matching on `description` field
- **Naming**: Must be flat (no nested folders), use `dwf-` prefix for namespacing
- **Skills**:
  - `dwf-manage-issue` - Creates/updates issues, separates requirements from implementation
  - `dwf-plan-issue` - Generates implementation plans with deployable task units
  - `dwf-work-task` - Manages task execution lifecycle

**Key constraint**: Claude Code does NOT support nested skill folders. Skills must be at `.claude/skills/{skill-name}/SKILL.md`, not `.claude/skills/namespace/{skill-name}/SKILL.md`.

**After modifying skills**: Always review changes against `scripts/revise-skills.md` before committing. This guide ensures skills remain concise and actionable - keeping step-by-step instructions, critical warnings, and reference tables while removing redundancy and verbose prose.

## References

- **Clean Code** by Robert C. Martin
- **Domain-Driven Design** by Eric Evans
- **Implementing Domain-Driven Design** by Vaughn Vernon
- **Design Patterns** by Gang of Four

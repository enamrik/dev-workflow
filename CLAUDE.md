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

### Pre-Push Validation

**IMPORTANT: Always run `make prep` before pushing to remote (PR or main branch).**

This command runs all validation checks in order with fail-fast behavior:

1. Type checking (`pnpm typecheck`)
2. Linting (`pnpm lint`)
3. Format checking (`pnpm format:check`)
4. Unit tests (`pnpm test`)
5. Integration tests (`pnpm test:integration`)

E2E tests are excluded because they use the Claude CLI and cost money. Integration tests provide comprehensive coverage by testing real code with mocked external boundaries.

### Working in Worktrees

When working on UI changes in an isolated worktree (via `start_task_session` with `mode: "isolated"`), always run the dev server to let the user verify changes:

```bash
make ui-dev-local
```

This command:

1. Installs dependencies if needed (`make worktree-setup`)
2. Creates a local `.track/` directory with test data
3. **Detects if running in a worktree** and calculates a unique port (3500 + issue % 100)
4. Starts the Next.js dev server and opens browser with issue filter querystring

For example, in worktree `issue-54-task-1`:

- Port: 3554 (3500 + 54 % 100)
- URL: http://localhost:3554/?issue=54

Ports are in range 3500-3599 using modulo to handle high issue numbers.

---

## ⚠️ IMPORTANT: Verification Workflow

**After completing ANY code changes, you MUST ask the user:**

> "Would you like me to run `make ui-dev-local` so you can verify the changes?"

**Do NOT submit for review until the user has had the opportunity to verify the changes.**

---

### Database Migrations

**IMPORTANT: NEVER delete `~/.track/workflow.db`!** This file contains all issue tracking data.

When making schema changes:

1. Update the schema in `packages/core/src/infrastructure/database/schema.ts`
2. Run `pnpm drizzle-kit generate` in `packages/core` to create an incremental migration
3. Run `dev-workflow update` to apply the migration

The generated migration will contain only the changes (ALTER TABLE statements), preserving existing data.

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

## Testing GitHub Sync

If you suspect GitHub sync issues (e.g., project column not updating after `submit_for_review`), run the test workflow:

```
Read scripts/test-workflow.md and execute the test workflow
```

This script tests the full issue lifecycle with verification steps using `gh api graphql` and `sqlite3` queries.

## Claude Code Skills vs Task Labels

This project has TWO separate systems - don't confuse them:

### 1. Claude Code Skills (for Claude's behavior)

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

### 2. Task Labels (for task execution context)

These provide contextual text returned from MCP tools during task execution.

- **Project labels**: `.track/labels/<label>.md` (per-project)
- **Global labels**: `~/.track/labels/<label>.md` (shared across projects)
- **Discovery**: Returned when calling `get_task_for_session` for tasks with matching labels
- **Validation**: MCP tools validate labels exist before assignment
- **Examples**: `api`, `db`, `security` (and any custom labels)

When a task has `labels: ["db", "api"]`, the corresponding label files are loaded and provided as context when retrieving the task for execution. Project labels take precedence over global labels with the same name.

## References

- **Clean Code** by Robert C. Martin
- **Domain-Driven Design** by Eric Evans
- **Implementing Domain-Driven Design** by Vaughn Vernon
- **Design Patterns** by Gang of Four

# Migration Plan: Effect Pattern with R-Type Propagation

## Design Philosophy

**One expression type.** `Effect<A, E, R>` is the only abstraction. No `ProjectQuery`, no `Query`, no `DomainTransaction`, no `DomainOp`. Service requirements propagate through the `R` type parameter — if a repo needs a database connection, that need bubbles up through every Effect that uses it, forcing the caller to provide it.

**Types enforce the rules.** Domain services can read (yield repos) but cannot write — they lack access to `TransactionContext`. Repos that mutate require a `TransactionContext` parameter, which only `DomainExecutor.transaction()` can create. This makes invalid states unrepresentable at the type level.

**Same operation everywhere.** Web API, MCP tool, and CLI command all call the same operation function. Middleware resolves the project and database connection per-request/invocation.

---

## Architecture Overview

### Before (Current)

```
Web Route / MCP Tool Handler / CLI Command
  → AppService (web) or Tool class (MCP)
    → Entity Service (IssueService, TaskService)
      → DbClient (project-scoped repo facade)
        → Repository (returns results directly)
```

- Services take `DbClient` in constructor (project-scoped)
- Each entry point has its own adapter layer (AppService, Tool class)
- No transaction support across multiple repos
- Repos are stateful (bound to db + projectId at construction)

### After (Target)

```
Web Route / MCP Tool Handler / CLI Command
  → [middleware provides AuthContext + Db]
  → Operation function (e.g., closeIssue)
    → DomainService (reads via repos, returns intent)
    → DomainExecutor.transaction (writes via repos + TransactionContext)
      → Repository (stateless singleton, yields AuthContext + Db)
```

- Repos are stateless singletons — yield `AuthContext` and `Db` from the Effect environment
- Domain services produce validated intents (what should change), not side effects
- Operations coordinate intents + external sync + transactional writes
- All entry points call the same operations
- Transactions are explicit and atomic via `DomainExecutor`

### Key Concepts

| Concept              | Type         | Purpose                                                                                                                           |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Effect<A, E, R>`    | Expression   | The only expression type. `A` = success, `E` = error, `R` = required services.                                                    |
| `AuthContext`        | Service      | Carries `{ projectId, projectSlug }`. Provided by middleware. Yielded by repos that need project scoping.                         |
| `Db`                 | Service      | Carries `{ connection: DrizzleDb }`. Provided by middleware. Yielded by repos that need database access.                          |
| `TransactionContext` | Branded type | `DrizzleDb & { readonly [TxBrand]: true }`. Only creatable inside `DomainExecutor.transaction()`. Required by repo write methods. |
| `DomainExecutor`     | Service      | Stateless singleton. `transaction()` yields `Db`, starts Drizzle tx, swaps `Db` with transactional one via `Effect.provide`.      |
| Domain Service       | Service      | Reads via repos (can yield them). Returns intents. Cannot write (no `TransactionContext`).                                        |
| Operation            | Function     | Composes domain service intents + external sync + `DomainExecutor.transaction()` writes. Entry points call these.                 |

### R-Type Propagation

When a repository method yields `AuthContext`, that requirement appears in R and propagates upward:

```
IssueRepository.findById(id)
  → Effect<Issue | null, DbError, AuthContext | Db>
                                   ^^^^^^^^^^^^^^^^
                                   Bubbles up through every caller

IssueDomainService.close(issueId)
  → Effect<CloseIssueIntent, BusinessError, AuthContext | Db | IssueRepository | TaskRepository>
                                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                            Repos + their deps all bubble up

closeIssue(issueId)  // operation
  → Effect<CloseResult, Error, AuthContext | Db | IssueRepository | TaskRepository | ...>
                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                               Middleware must provide AuthContext + Db
                               Container must provide repos + services
```

The type system tells you exactly what's needed. Middleware provides `AuthContext` + `Db` (per-request). The Awilix container provides everything else (singletons).

---

## Phase 1: Effect Package

Copy the Effect system from as-platform into dev-workflow.

### New package: `packages/effect/`

| File                    | Source                                              | Notes                                                       |
| ----------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `src/effect.ts`         | `as-platform/packages/effect/src/effect.ts`         | Direct copy. Effect, Service, Tag, gen, make, provide, etc. |
| `src/effect-runtime.ts` | `as-platform/packages/effect/src/effect-runtime.ts` | Direct copy. createRuntime, runEffect, unwrap.              |
| `src/index.ts`          | New                                                 | Re-exports.                                                 |
| `package.json`          | New                                                 | `@dev-workflow/effect`                                      |
| `tsconfig.json`         | New                                                 | Standard config.                                            |

### Key APIs from the Effect system:

```typescript
// Creating effects
Effect.gen(function* () { ... })     // Generator-based composition
Effect.succeed(value)                 // Pure success
Effect.fail(error)                    // Pure failure
Effect.tryPromise({ try, catch })     // Wrap async operations

// Composition
Effect.provide(effect, deps)          // Satisfy R requirements (strips them from R)
Effect.map(effect, fn)                // Transform success value
Effect.flatMap(effect, fn)            // Chain effects
Effect.all([...effects])              // Sequential execution

// Services (yieldable in generators)
class Foo extends Service<Foo>()('Foo') { ... }
// Usage: const foo = yield* Foo;

// Running
Effect.runPromise(effect, deps)       // Run and unwrap
runWithContainer(effect, container)   // Run with Awilix container
```

---

## Phase 2: Core Services

### 2a. AuthContext

**File:** `packages/tracking/src/auth-context.ts`

```typescript
import { Service } from "@dev-workflow/effect";

/**
 * AuthContext - Project identity provided by middleware
 *
 * Yielded by repositories that need project scoping.
 * Provided per-request by middleware (not in the container).
 */
export class AuthContext extends Service<AuthContext>()("AuthContext") {
  constructor(
    readonly projectId: string,
    readonly projectSlug: string
  ) {
    super();
  }
}
```

### 2b. Db

**File:** `packages/tracking/src/db.ts`

```typescript
import { Service } from "@dev-workflow/effect";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/**
 * Db - Database connection provided by middleware
 *
 * Yielded by repositories that need database access.
 * Provided per-request by middleware (not in the container).
 * DomainExecutor.transaction() swaps this with a transactional connection.
 */
export class Db extends Service<Db>()("Db") {
  constructor(readonly connection: DrizzleDb) {
    super();
  }
}
```

### 2c. TransactionContext

**File:** `packages/tracking/src/transaction-context.ts`

```typescript
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

declare const TxBrand: unique symbol;

/**
 * TransactionContext - Branded DrizzleDb that proves we're inside a transaction
 *
 * Only DomainExecutor.transaction() can create this.
 * Repository write methods require it as a parameter.
 * Domain services cannot obtain it — they can read but not write.
 */
export type TransactionContext = DrizzleDb & { readonly [TxBrand]: true };
```

### 2d. Add `transaction()` to DrizzleDb

**File:** `packages/database/src/drizzle-db.ts` (add to existing interface)

```typescript
export interface DrizzleDb {
  select(fields?: any): DrizzleSelectBuilder;
  insert(table: any): DrizzleInsertBuilder;
  update(table: any): DrizzleUpdateBuilder;
  delete(table: any): DrizzleDeleteBuilder;
  // NEW
  transaction<T>(fn: (tx: DrizzleDb) => T | Promise<T>): T | Promise<T>;
}
```

Both BetterSQLite3Database and NeonHttpDatabase support `.transaction()` natively in Drizzle.

### 2e. DomainExecutor

**File:** `packages/tracking/src/domain-executor.ts`

```typescript
import { Effect, Service } from "@dev-workflow/effect";
import { Db } from "./db.js";
import type { TransactionContext } from "./transaction-context.js";

/**
 * DomainExecutor - Runs effects inside database transactions
 *
 * Stateless singleton. transaction() yields Db from the environment,
 * starts a Drizzle transaction, then re-provides Db with the transactional
 * connection. This means repos inside the transaction automatically use
 * the transactional connection when they yield* Db.
 *
 * The callback receives a TransactionContext for repo write methods.
 */
export class DomainExecutor extends Service<DomainExecutor>()("DomainExecutor") {
  transaction<A, E, R>(
    fn: (tx: TransactionContext) => Effect<A, E, R>
  ): Effect<A, E | TxError, R | Db> {
    return Effect.gen(function* () {
      const { connection } = yield* Db;

      return yield* Effect.make(async (env) => {
        try {
          const result = await connection.transaction(async (txClient) => {
            // Create branded TransactionContext
            const tx = txClient as TransactionContext;

            // Build the inner effect with the tx callback
            const innerEffect = fn(tx);

            // Swap Db with transactional connection
            const provided = Effect.provide(innerEffect, {
              Db: new Db(txClient),
            });

            // Run inner effect
            const innerResult = await provided._run(env);
            if (innerResult._tag === "Left") {
              // Throw to trigger Drizzle rollback
              throw new TxRollback(innerResult.left);
            }
            return innerResult.right;
          });

          return { _tag: "Right" as const, right: result };
        } catch (e) {
          if (e instanceof TxRollback) {
            return { _tag: "Left" as const, left: e.cause as E };
          }
          return { _tag: "Left" as const, left: new TxError(e) as E | TxError };
        }
      });
    });
  }
}

class TxRollback {
  constructor(readonly cause: unknown) {}
}

export class TxError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "TxError";
  }
}
```

**How `Effect.provide` enables transactions:**

1. Middleware provides `Db` with the normal connection
2. Repos yield `Db` and get the normal connection
3. Inside `DomainExecutor.transaction()`, `Effect.provide` replaces `Db` with a transactional one
4. Repos inside the transaction yield `Db` and get the transactional connection — automatically
5. `TransactionContext` is the branded type passed to the callback for write methods

---

## Phase 3: Convert Repositories

Repositories become stateless Effect `Service` singletons. Read methods yield `AuthContext` and `Db`. Write methods additionally require a `TransactionContext` parameter.

### Pattern: Read method (yields AuthContext + Db)

```typescript
import { Effect, Service } from "@dev-workflow/effect";
import { AuthContext } from "../auth-context.js";
import { Db } from "../db.js";

export class IssueRepository extends Service<IssueRepository>()("IssueRepository") {
  findById(id: string) {
    return Effect.gen(function* () {
      const { projectId } = yield* AuthContext;
      const { connection } = yield* Db;
      const row = connection
        .select()
        .from(issues)
        .where(and(eq(issues.projectId, projectId), eq(issues.id, id), eq(issues.isDeleted, false)))
        .get();
      return row ? mapToIssue(row) : null;
    });
    // Return type: Effect<Issue | null, never, AuthContext | Db>
  }

  findMany(filter: IssueFilter) {
    return Effect.gen(function* () {
      const { projectId } = yield* AuthContext;
      const { connection } = yield* Db;
      // ... query with filter
      return rows.map(mapToIssue);
    });
    // Return type: Effect<Issue[], never, AuthContext | Db>
  }
}
```

### Pattern: Write method (requires TransactionContext)

```typescript
export class IssueRepository extends Service<IssueRepository>()("IssueRepository") {
  // ... read methods above ...

  create(tx: TransactionContext, input: CreateIssueInput) {
    return Effect.gen(function* () {
      const { projectId } = yield* AuthContext;
      const rows = tx
        .insert(issues)
        .values({ projectId, ...input })
        .returning()
        .all();
      return mapToIssue(rows[0]!);
    });
    // Return type: Effect<Issue, never, AuthContext>
    // Note: uses tx directly, does NOT yield Db
  }

  update(tx: TransactionContext, id: string, data: Partial<IssueUpdate>) {
    return Effect.gen(function* () {
      const { projectId } = yield* AuthContext;
      const rows = tx
        .update(issues)
        .set(data)
        .where(and(eq(issues.projectId, projectId), eq(issues.id, id)))
        .returning()
        .all();
      return mapToIssue(rows[0]!);
    });
    // Return type: Effect<Issue, never, AuthContext>
  }
}
```

**Why write methods take `TransactionContext` as a parameter:**

- Domain services cannot call write methods — they don't have a `TransactionContext`
- Operations call writes inside `DomainExecutor.transaction()`, which provides the `TransactionContext`
- The type system enforces this: you can't call `repo.create(tx, ...)` without a `tx`
- Read methods don't need `TransactionContext` — they yield `Db` and get the right connection automatically (normal or transactional, depending on whether `Effect.provide` swapped it)

### Repositories to convert

**Project-scoped (yield AuthContext + Db for reads, TransactionContext for writes):**

| Current file                                                   | New location                                              |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `tracking/src/data-access/drizzle-issue-repository.ts`         | `tracking/src/issues/issue-repository.ts`                 |
| `tracking/src/data-access/drizzle-task-repository.ts`          | `tracking/src/tasks/task-repository.ts`                   |
| `tracking/src/data-access/drizzle-plan-repository.ts`          | `tracking/src/plans/plan-repository.ts`                   |
| `tracking/src/data-access/drizzle-milestone-repository.ts`     | `tracking/src/milestones/milestone-repository.ts`         |
| `tracking/src/data-access/drizzle-snapshot-repository.ts`      | `tracking/src/snapshots/snapshot-repository.ts`           |
| `tracking/src/data-access/drizzle-execution-log-repository.ts` | `tracking/src/execution-logs/execution-log-repository.ts` |

**Global (yield Db only for reads, no AuthContext needed):**

| Current file                                  | New location                      |
| --------------------------------------------- | --------------------------------- |
| `tracking/src/projects/project-repository.ts` | Keep (convert to Service pattern) |
| `tracking/src/types/type-repository.ts`       | Keep (convert to Service pattern) |
| `tracking/src/global-settings-repository.ts`  | Keep (convert to Service pattern) |

---

## Phase 4: Domain Services

Domain services encapsulate business rules. They **can read** (yield repos, which yield `AuthContext` + `Db`) but **cannot write** (no `TransactionContext`). They return **intents** — validated descriptions of what should change.

### Pattern: Domain service returning an intent

```typescript
import { Effect, Service } from "@dev-workflow/effect";
import { IssueRepository } from "./issue-repository.js";
import { TaskRepository } from "../tasks/task-repository.js";
import { isIssueClosed, isTerminal } from "../index.js";

// Intent types — plain data describing what should change
export interface CloseIssueIntent {
  readonly issue: Issue;
  readonly issueUpdate: { status: "CLOSED"; closedAt: Date };
  readonly tasksToAbandon: Task[];
}

export class IssueDomainService extends Service<IssueDomainService>()("IssueDomainService") {
  /**
   * Validate and plan closing an issue.
   * Reads current state, checks business rules, returns intent.
   * Does NOT write — caller executes the intent in a transaction.
   */
  close(issueId: string) {
    return Effect.gen(function* () {
      const issueRepo = yield* IssueRepository;
      const taskRepo = yield* TaskRepository;

      const issue = yield* issueRepo.findById(issueId);
      if (!issue) {
        return yield* Effect.fail(new EntityNotFoundError("Issue", issueId));
      }
      if (isIssueClosed(issue)) {
        return yield* Effect.fail(new BusinessRuleError("Issue is already closed"));
      }

      const tasks = yield* taskRepo.findByIssueId(issueId);
      const tasksToAbandon = tasks.filter((t) => !isTerminal(t));

      return {
        issue,
        issueUpdate: { status: "CLOSED" as const, closedAt: new Date() },
        tasksToAbandon,
      } satisfies CloseIssueIntent;
    });
    // Return type: Effect<CloseIssueIntent, EntityNotFoundError | BusinessRuleError,
    //   AuthContext | Db | IssueRepository | TaskRepository>
  }

  /**
   * Validate issue creation input.
   */
  validateCreate(input: CreateIssueInput) {
    return Effect.gen(function* () {
      if (!input.title?.trim()) {
        return yield* Effect.fail(new ValidationError("Title is required"));
      }
      // ... more validation
      return { ...input, title: input.title.trim() };
    });
    // Return type: Effect<CreateIssueInput, ValidationError, never>
    // Note: pure validation needs no services
  }
}
```

### Domain services to create

| Service                  | File                                                  | Responsibility                                           |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| `IssueDomainService`     | `tracking/src/issues/issue-domain-service.ts`         | Issue validation, close intent, status transitions       |
| `TaskDomainService`      | `tracking/src/tasks/task-domain-service.ts`           | Task validation, status transition rules, abandon intent |
| `PlanDomainService`      | `tracking/src/plans/plan-domain-service.ts`           | Plan validation                                          |
| `MilestoneDomainService` | `tracking/src/milestones/milestone-domain-service.ts` | Milestone validation                                     |

### What domain services cannot do

```typescript
// This would NOT compile — domain service has no TransactionContext
class IssueDomainService {
  close(issueId: string) {
    return Effect.gen(function* () {
      const issueRepo = yield* IssueRepository;
      const issue = yield* issueRepo.findById(issueId);

      // ❌ Cannot call write method — no TransactionContext parameter
      yield* issueRepo.update(???, issueId, { status: 'CLOSED' });
      //                      ^^^
      //         Where would this come from? Domain service can't get one.

      // ✅ Instead, return an intent
      return { issue, issueUpdate: { status: 'CLOSED' } };
    });
  }
}
```

---

## Phase 5: Operations

Operations are standalone functions that coordinate:

1. Domain service intents (reads + validation)
2. External integrations (GitHub sync, etc.)
3. Transactional writes (via `DomainExecutor.transaction()`)

All entry points (web, MCP, CLI) call the same operations.

**Location:** `packages/tracking/src/operations/`

### Pattern: Operation

```typescript
// tracking/src/operations/close-issue.ts
import { Effect } from "@dev-workflow/effect";
import { IssueRepository } from "../issues/issue-repository.js";
import { TaskRepository } from "../tasks/task-repository.js";
import { IssueDomainService } from "../issues/issue-domain-service.js";
import { DomainExecutor } from "../domain-executor.js";
import { ProjectSyncService } from "../project-sync/project-sync-service.js";

export function closeIssue(issueId: string) {
  return Effect.gen(function* () {
    const issueRepo = yield* IssueRepository;
    const taskRepo = yield* TaskRepository;
    const rules = yield* IssueDomainService;
    const domain = yield* DomainExecutor;
    const sync = yield* ProjectSyncService;

    // 1. Read + validate (domain service)
    const intent = yield* rules.close(issueId);

    // 2. External sync BEFORE local changes (side effect)
    if (intent.issue.githubSync?.githubIssueNumber) {
      yield* sync.closeIssue(String(intent.issue.githubSync.githubIssueNumber));
    }

    // 3. Atomic writes (transaction)
    const result = yield* domain.transaction((tx) =>
      Effect.gen(function* () {
        // Abandon active tasks
        const abandonedTasks = [];
        for (const task of intent.tasksToAbandon) {
          const abandoned = yield* taskRepo.update(tx, task.id, {
            status: "ABANDONED",
            abandonedAt: new Date(),
          });
          abandonedTasks.push(abandoned);
        }

        // Close the issue
        const closedIssue = yield* issueRepo.update(tx, issueId, intent.issueUpdate);

        return { issue: closedIssue, abandonedTasks };
      })
    );

    return result;
  });
}
```

### Read-only operations

Read-only operations don't need `DomainExecutor` — repos yield `Db` directly:

```typescript
// tracking/src/operations/get-issue.ts
export function getIssue(issueNumber: number) {
  return Effect.gen(function* () {
    const issueRepo = yield* IssueRepository;
    const issue = yield* issueRepo.findByNumber(issueNumber);
    if (!issue) return yield* Effect.fail(new EntityNotFoundError("Issue", String(issueNumber)));
    return issue;
  });
}
```

### Operations to create

| Operation         | File                             |
| ----------------- | -------------------------------- |
| `createIssue`     | `operations/create-issue.ts`     |
| `updateIssue`     | `operations/update-issue.ts`     |
| `closeIssue`      | `operations/close-issue.ts`      |
| `deleteIssue`     | `operations/delete-issue.ts`     |
| `assignMilestone` | `operations/assign-milestone.ts` |
| `createTask`      | `operations/create-task.ts`      |
| `updateTask`      | `operations/update-task.ts`      |
| `transitionTask`  | `operations/transition-task.ts`  |
| `abandonTask`     | `operations/abandon-task.ts`     |
| `generatePlan`    | `operations/generate-plan.ts`    |
| `createMilestone` | `operations/create-milestone.ts` |
| `updateMilestone` | `operations/update-milestone.ts` |
| `deleteMilestone` | `operations/delete-milestone.ts` |

---

## Phase 6: Middleware

Middleware resolves project identity and database connection per-request. It produces `AuthContext` and `Db` services that get merged into the Effect environment.

### How it works

```
Request arrives (with project slug)
  → ProjectsResolver.getProjectBySlug(slug) → ProjectInfo { projectId, sourceInfo }
  → DbSourceProvider.getOrCreate(sourceInfo) → DbSource { getDb() }
  → return { AuthContext: new AuthContext(projectId, slug), Db: new Db(dbSource.getDb()) }
```

### Middleware functions

```typescript
// packages/tracking/src/middleware/project-middleware.ts
import { Effect } from "@dev-workflow/effect";
import { AuthContext } from "../auth-context.js";
import { Db } from "../db.js";
import { ProjectsResolver } from "../projects/projects-resolver.js";
import { DbSourceProvider } from "../data-access/db-source-provider.js";

// For Web: resolve from URL param
export function projectFromParam(projectSlug: string) {
  return Effect.gen(function* () {
    const resolver = yield* ProjectsResolver;
    const dbProvider = yield* DbSourceProvider;

    const project = yield* Effect.tryPromise({
      try: () => resolver.getProjectBySlug(projectSlug),
      catch: (e) => e as Error,
    });

    const dbSource = dbProvider.getOrCreate(project.sourceInfo);

    return {
      AuthContext: new AuthContext(project.projectId, projectSlug),
      Db: new Db(dbSource.getDb()),
    };
  });
}

// For MCP: resolve from env var
export function projectFromEnv() {
  return Effect.gen(function* () {
    const slug = process.env["PROJECT_SLUG"];
    if (!slug) return yield* Effect.fail(new Error("PROJECT_SLUG not set"));
    return yield* projectFromParam(slug);
  });
}

// For CLI: resolve from git config in cwd
export function projectFromGit() {
  return Effect.gen(function* () {
    const config = yield* Effect.tryPromise({
      try: () => resolveConfigFromGit(process.cwd()),
      catch: (e) => e as Error,
    });

    const dbProvider = yield* DbSourceProvider;
    const dbSource = dbProvider.getOrCreate({ connectionString: config.database });

    return {
      AuthContext: new AuthContext(config.projectId, config.slug),
      Db: new Db(dbSource.getDb()),
    };
  });
}
```

### What the container provides vs what middleware provides

```
Container (Awilix, singleton lifetime)     Middleware (per-request)
──────────────────────────────────────     ──────────────────────
ProjectsResolver                            AuthContext
DbSourceProvider                            Db
DomainExecutor
IssueRepository
TaskRepository
PlanRepository
MilestoneRepository
IssueDomainService
TaskDomainService
PlanDomainService
MilestoneDomainService
ProjectSyncService
```

---

## Phase 7: Handler Factories

Each entry point (web, MCP, CLI) has a handler factory that:

1. Validates input
2. Runs middleware (provides `AuthContext` + `Db`)
3. Executes the operation Effect with the merged environment
4. Maps the result to the appropriate response format

### 7a. Web: `createApiHandler`

**File:** `apps/web/src/lib/di/bootstrap.ts`

```typescript
export function createApiHandler<TBody = void>(config: {
  container: AwilixContainer<WebCradle>;
  middleware: (
    req: Request,
    params: Record<string, string>
  ) => Effect<MiddlewareResult, Error, any>;
  request?: ZodSchema;
  handler: (body: TBody, params: Record<string, string>) => Effect<unknown, unknown, unknown>;
}) {
  return async (req: Request, context?: RouteContext): Promise<NextResponse> => {
    try {
      // 1. Parse request body
      const body = config.request ? parseJsonBody(config.request, await req.json()) : undefined;

      // 2. Run middleware to get AuthContext + Db
      const params = context?.params ? await context.params : {};
      const mwResult = await createRuntime(config.container).runEffect(
        config.middleware(req, params)
      );
      if (mwResult._tag === "Left") {
        return NextResponse.json(mapError(mwResult.left), { status: 400 });
      }

      // 3. Execute handler with container cradle + middleware result merged
      const effect = config.handler(body as TBody, params);
      const provided = Effect.provide(effect, mwResult.right);
      const result = await createRuntime(config.container).runEffect(provided);

      if (result._tag === "Left") {
        const mapped = mapError(result.left);
        return NextResponse.json(mapped.body, { status: mapped.status });
      }
      return NextResponse.json(result.right);
    } catch (error) {
      const mapped = mapError(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
  };
}
```

**Usage:**

```typescript
// apps/web/src/app/api/projects/[project]/issues/[issueNumber]/close/route.ts
export const POST = createApiHandler({
  container: getWebContainer(),
  middleware: (req, params) => projectFromParam(params["project"]!),
  handler: (_, params) => closeIssue(params["issueNumber"]!),
});
```

### 7b. MCP: `createMcpHandler`

**File:** `apps/mcp-server/src/di/bootstrap.ts`

```typescript
export function createMcpHandler<TArgs extends ZodSchema>(config: {
  schema: TArgs;
  middleware: () => Effect<MiddlewareResult, Error, any>;
  handler: (args: z.infer<TArgs>) => Effect<unknown, unknown, unknown>;
}) {
  return (container: AwilixContainer<McpCradle>) =>
    async (args: unknown): Promise<ToolResponse> => {
      try {
        const validated = validateSchema(config.schema, args);

        const mwResult = await createRuntime(container).runEffect(config.middleware());
        if (mwResult._tag === "Left") return errorResponse(String(mwResult.left));

        const effect = config.handler(validated);
        const provided = Effect.provide(effect, mwResult.right);
        const result = await createRuntime(container).runEffect(provided);

        if (result._tag === "Left") return errorResponse(String(result.left));
        return successResponse(result.right);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    };
}
```

**Usage:**

```typescript
export const handleCloseIssue = createMcpHandler({
  schema: CloseIssueSchema,
  middleware: projectFromEnv,
  handler: (args) => closeIssue(args.issueId),
});
```

### 7c. CLI: `createCliHandler`

**File:** `apps/cli/src/di/bootstrap.ts`

```typescript
export function createCliHandler<TOpts>(config: {
  middleware: () => Effect<MiddlewareResult, Error, any>;
  handler: (opts: TOpts) => Effect<void, unknown, unknown>;
}) {
  return async (options: TOpts, container: AwilixContainer<CliCradle>): Promise<void> => {
    try {
      const mwResult = await createRuntime(container).runEffect(config.middleware());
      if (mwResult._tag === "Left") throw mwResult.left;

      const effect = config.handler(options);
      const provided = Effect.provide(effect, mwResult.right);
      const result = await createRuntime(container).runEffect(provided);

      if (result._tag === "Left") throw result.left;
    } catch (error) {
      handleCliError(error);
    }
  };
}
```

**Usage:**

```typescript
export const handleCloseIssue = createCliHandler({
  middleware: projectFromGit,
  handler: (opts) => closeIssue(opts.issueId),
});
```

---

## Phase 8: Container Updates

### Shared registrations (all containers)

All containers register stateless singletons:

```typescript
import { asFunction } from 'awilix';

// Repositories (stateless singletons — yield AuthContext + Db internally)
IssueRepository: asFunction(() => new IssueRepository()).singleton(),
TaskRepository: asFunction(() => new TaskRepository()).singleton(),
PlanRepository: asFunction(() => new PlanRepository()).singleton(),
MilestoneRepository: asFunction(() => new MilestoneRepository()).singleton(),
SnapshotRepository: asFunction(() => new SnapshotRepository()).singleton(),
ExecutionLogRepository: asFunction(() => new ExecutionLogRepository()).singleton(),

// Global repos (yield Db only)
ProjectRepository: asFunction(() => new ProjectRepository()).singleton(),
TypeRepository: asFunction(() => new TypeRepository()).singleton(),
GlobalSettingsRepository: asFunction(() => new GlobalSettingsRepository()).singleton(),

// Domain Services (stateless singletons — yield repos internally)
IssueDomainService: asFunction(() => new IssueDomainService()).singleton(),
TaskDomainService: asFunction(() => new TaskDomainService()).singleton(),
PlanDomainService: asFunction(() => new PlanDomainService()).singleton(),
MilestoneDomainService: asFunction(() => new MilestoneDomainService()).singleton(),

// Infrastructure (stateless singletons)
DomainExecutor: asFunction(() => new DomainExecutor()).singleton(),
ProjectsResolver: asFunction(() => new ProjectsResolver()).singleton(),
DbSourceProvider: asFunction(() => new DbSourceProvider()).singleton(),
```

**NOT in the container** (provided per-request by middleware):

- `AuthContext` — depends on which project the request targets
- `Db` — depends on which database the project uses

### Files to delete after migration

| File                                                   | Replaced by                                |
| ------------------------------------------------------ | ------------------------------------------ |
| `apps/web/src/lib/app-services/issue-app-service.ts`   | Operations                                 |
| `apps/web/src/lib/app-services/task-app-service.ts`    | Operations                                 |
| `apps/web/src/lib/app-services/project-app-service.ts` | Operations                                 |
| `apps/mcp-server/src/tools/issue-tool.ts`              | Operations                                 |
| `apps/mcp-server/src/tools/task-tool.ts`               | Operations                                 |
| `apps/mcp-server/src/tools/plan-tool.ts`               | Operations                                 |
| `apps/mcp-server/src/tools/milestone-tool.ts`          | Operations                                 |
| `tracking/src/issues/issue-service.ts`                 | IssueDomainService + operations            |
| `tracking/src/tasks/task-service.ts`                   | TaskDomainService + operations             |
| `tracking/src/plans/plan-service.ts`                   | PlanDomainService + operations             |
| `tracking/src/milestones/milestone-service.ts`         | MilestoneDomainService + operations        |
| `tracking/src/data-access/db-client.ts`                | No longer needed (repos yield Db directly) |
| `tracking/src/data-access/drizzle-db-client.ts`        | No longer needed                           |

---

## Phase 9: Migrate Entry Points

### Before/After: Web API

**Before:**

```typescript
// endpoint.ts — calls AppService which resolves project + delegates to entity service
export async function closeIssueEndpoint(
  req: Request,
  params: Record<string, string>,
  { issueAppService }: Pick<WebCradle, "issueAppService">
): Promise<NextResponse> {
  const body = await req.json();
  const result = await issueAppService.closeIssue(body.projectSlug, Number(params.issueNumber));
  return NextResponse.json(result);
}

export const endpoint = createApiEndpoint(closeIssueEndpoint);
export const POST = createApiRoute(endpoint);
```

**After:**

```typescript
// route.ts — calls operation directly
export const POST = createApiHandler({
  container: getWebContainer(),
  middleware: (req, params) => projectFromParam(params["project"]!),
  handler: (_, params) => closeIssue(params["issueNumber"]!),
});
```

### Before/After: MCP

**Before:**

```typescript
// Tool class with constructor DI
export class IssueTool {
  constructor(private readonly issueService: IssueService, ...) {}
  async closeIssue(issueId: string) { return this.issueService.closeIssue(issueId); }
}

// Handler validates + delegates to tool
export const handleCloseIssue = createMcpHandler(
  (args, { issueTool }) => successResponse(issueTool.closeIssue(args.issueId))
);
```

**After:**

```typescript
export const handleCloseIssue = createMcpHandler({
  schema: CloseIssueSchema,
  middleware: projectFromEnv,
  handler: (args) => closeIssue(args.issueId), // same operation as web
});
```

### Before/After: CLI

**Before:**

```typescript
export async function handleCloseIssue(opts: CloseOpts, { issueService, db }: CliCradle) {
  const issue = db.issues.findByNumber(opts.issueNumber);
  await issueService.closeIssue(issue.id);
}
```

**After:**

```typescript
export const handleCloseIssue = createCliHandler({
  middleware: projectFromGit,
  handler: (opts) => closeIssue(opts.issueId), // same operation as web + MCP
});
```

---

## Implementation Order

| Step | Description                                                        | Risk       | Notes                                                    |
| ---- | ------------------------------------------------------------------ | ---------- | -------------------------------------------------------- |
| 1    | Create `packages/effect/` (copy from as-platform)                  | Low        | Additive, no changes to existing code                    |
| 2    | Create `AuthContext`, `Db`, `TransactionContext`, `DomainExecutor` | Low        | Additive, no changes to existing code                    |
| 3    | Add `transaction()` to `DrizzleDb` interface                       | Low        | Additive interface change                                |
| 4    | Convert ONE repo (`IssueRepository`) to Effect Service pattern     | Medium     | Proves the read/write split pattern                      |
| 5    | Create ONE domain service (`IssueDomainService`)                   | Medium     | Proves intent pattern                                    |
| 6    | Create ONE operation (`closeIssue`)                                | Medium     | Proves end-to-end composition                            |
| 7    | Create middleware + adapt ONE entry point (MCP `close_issue` tool) | Medium     | Proves full pipeline                                     |
| 8    | **Validate end-to-end**                                            | Critical   | Run the close issue flow through MCP                     |
| 9    | Convert remaining repos                                            | Mechanical | Follow established pattern                               |
| 10   | Create remaining domain services + operations                      | Mechanical | Follow established pattern                               |
| 11   | Adapt remaining entry points                                       | Mechanical | Follow established pattern                               |
| 12   | Update containers                                                  | Low        | Register new services                                    |
| 13   | Delete old code                                                    | Low        | AppServices, Tool classes, old entity services, DbClient |

---

## Verification

1. `make prep` passes (typecheck, lint, format, tests)
2. MCP tools work: create/close issue, create/transition task
3. Web API routes work: same operations via browser
4. CLI commands work: same operations via terminal
5. Transactions are atomic: multi-step operations roll back on failure
6. Domain services cannot write: attempting to call a write method without `TransactionContext` is a compile error
7. R-type propagation: missing middleware causes a type error, not a runtime error

# dev-workflow Coding Standards

## Core Architecture

**OOP + SOLID + DDD.** Classes encapsulate behavior. Depend on abstractions. Rich domain models with business logic in entities.

## Critical Abstractions

### DataSourceProvider (NEVER BYPASS)

All repositories created through `DataSourceProvider`. Supports SQLite (CLI/MCP) and PostgreSQL (web).

```typescript
// ✅ Get repository through factory
const repo = dataSource.createIssueRepository(projectId);

// ❌ NEVER create directly
const repo = new SqliteIssueRepository(db);
```

**When adding tables/repositories:**
1. Update BOTH `schema.ts` (SQLite) AND `schema-pg.ts` (PostgreSQL)
2. Add factory method to `DataSourceProvider`
3. Implement in both `SqliteDataSource` and `NeonDataSource`
4. Use `DrizzleDatabase` type (dialect-agnostic)

### Service Layer (Orchestration)

Presentation layers (MCP/API/CLI) call services. Services call repositories. Services can call other services.

```typescript
// ✅ Presentation → Service
await issueService.closeIssue(id);

// ❌ NEVER Presentation → Repository for mutations
issueRepository.update(id, { status: "CLOSED" });
```

### Status Traits (Table-Driven)

Use trait functions from `packages/tracking/src/tasks/types.ts`:

```typescript
// ✅ Use traits
import { isTerminal, isActive } from "@dev-workflow/tracking";
const done = tasks.filter(isTerminal);

// ❌ NEVER check status directly
const done = tasks.filter(t => t.status === "COMPLETED");
```

| Function | Returns true for |
|----------|------------------|
| `isTerminal(task)` | COMPLETED, ABANDONED |
| `isWorkable(task)` | BACKLOG, READY, IN_PROGRESS |
| `isActive(task)` | IN_PROGRESS, PR_REVIEW |

## Anti-Patterns

❌ `as any`, `@ts-ignore` - fix types instead
❌ Direct repository mutations from presentation layer
❌ Duplicating logic across services (call the service instead)
❌ Scattered status checks (`status === "COMPLETED"`)
❌ Bypassing `DataSourceFactory.create()` with direct `createSqlite()`
❌ Manual `jsonBody()` in web handlers (use `bodySchema` option)
❌ `Effect.runPromise(effect, cradle as never)` (use `createRuntime`)
❌ `container.cradle` access in handlers (yield service tags)
❌ God classes/modules with unrelated methods
❌ Global mutable state (`let instance = null`)
❌ `Impl` suffix for class names

## Bootstrap Pattern

All mediums (MCP/Web/CLI): Handler returns `Effect<R, E, Response>` → Program creator validates/catches → Runner resolves R via `createRuntime`.

## Development

```bash
make dogfood      # Full reset + build + link + init
make prep         # All checks before push (REQUIRED)
make ui-dev-local # UI dev server (auto-detects worktree port)
```

**MCP restart:** `pkill -f "dev-workflow.*mcp"` or `/mcp` in Claude Code

**Git:** Always squash/rebase merge. Never merge commits. Run `git fetch --prune` after task completion.

**Migrations:** Update BOTH schemas, run `pnpm drizzle-kit generate`, then `dev-workflow update`. Never delete `~/.track/workflow.db`.

## Worktrees

All file operations use worktree path from `load_task_session`. Never fall back to main repo.

```
❌ Read("/Users/user/code/project/file")
✅ Read("/Users/user/.track/project/worktrees/issue-1-task-1/file")
```

**Verification:** After code changes, ask user to run `make ui-dev-local` before submitting PR.

## Operations Pattern

Operations are thin orchestrators. Domain logic lives in services.

```typescript
// Operation: validate → resolve → call service → side effects
const issue = yield* issueDomainService.getOne({ byNumber });
const result = yield* planDomainService.savePlan({ ... });
yield* versioningService.createSnapshot(...);
```

## Soft Delete

`issues` and `tasks` tables have soft delete. Repository queries filter `isDeleted=false` by default.

## Skills

Location: `.claude/skills/dwf-*/SKILL.md`
Source: `apps/cli/skills/dwf-*/SKILL.md`

After modifying: review against `scripts/revise-skills.md`.

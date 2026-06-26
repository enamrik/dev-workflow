# dev-workflow Coding Standards

# ⚠️ THE MANDATORIES — Always Active

## 0. One Commit Per Push to `main`

**Collapse all local commits into a single commit before pushing to `main`.** Iterating with many small WIP commits locally is fine — but `main` gets ONE commit for the unit of work, never a stream of "fix typo", "lockfile", "address review", "fix again" commits. Before any `git push` to `main`: squash your local commits (`git reset --soft <base>` then one `git commit`, or interactive rebase) into one well-described commit, then push. This keeps `main` history readable and bisectable. (Branches/PRs may carry intermediate commits; the squash applies when landing on `main`.)

## 1. Plan Agent Before Non-Trivial Work

**Non-trivial work starts with a `Plan` subagent, not with code.** Diving straight into implementation is how an agent under-reads: it skips the existing abstractions, never loads the patterns, duplicates what already exists — or gets halfway in, hits a surprise, and starts *patching its first idea* instead of pausing to rethink. The Plan agent front-loads the reading so the implementation is the right shape from line one.

- **When:** anything past a trivial one-liner / mechanical edit — a new feature, a refactor, a change to unfamiliar code or spanning more than ~1–2 files. Skip only for truly mechanical edits (a flag, a typo, a version/pin bump).
- **How — prompt it to do the homework you'd otherwise skip.** Spawn a `Plan` subagent and require it to: (1) **load the relevant skills** (`abstraction-first`, the path-scoped patterns) + this file's rules; (2) **read the actual code in scope deeply** — the domain concept, the class that already owns it, the call sites; (3) name the existing abstraction the change extends (the 60-80% rule: find the class, don't sprinkle loose helpers); (4) return a step-by-step plan that **cites the specific files/types it builds on**, the end-state shape, and what it could **not** determine. A plan that cites no real code it read isn't a plan — send it back.
- **Then build from the plan**, not from your first guess.
- **The forcing rule (pairs with #2):** if mid-implementation you discover the plan was wrong — you didn't understand enough, the design doesn't fit, you're about to patch around a surprise — **STOP. Do not patch forward.** Re-plan (re-run the Plan agent with what you learned, or pause and redesign). Panic-patching a half-understood design is the exact failure this mandate exists to prevent.

Plan (front) and the Adversarial Review agent (#2, before push) are bookends: plan so you build it right; review so you catch what slipped.

## 2. Adversarial Review Agent Before Every PR

**No PR opens or updates without first spawning a critical-review subagent over the diff.** `make prep` is the mechanical gate; the review agent is the **judgment** gate — it catches what green tests cannot: wrong-but-compiling logic, code paths the author never read, scope mismatches, half-finished removals, "the test passes because it doesn't cover the bug."

- **When — the trigger is the PUSH, not the commit.** Commit locally as often as you like with no review. The review is mandatory **before any `git push` of behavior-changing commits to a PR branch** (and before `gh pr create`) — run it once `make prep` is green, over everything the push will land (`git log origin/<branch>..HEAD`). If you notice a push already happened without one, run it immediately after and act on the findings. Skip only for pure doc/comment pushes; the user can also ask for one mid-work anytime.
- **Re-run on every change — a review covers only the commits it saw.** A prior review does NOT carry over to commits added after it. Every push re-runs the agent over the *new* range since the last reviewed sha; if you amended/rebased or added commits, the review is stale and must run again. The rule of thumb: the sha at `HEAD` when you push must be a sha a review has actually examined.
- **How:** launch a `general-purpose` subagent with the commit range, the *intent*, and an explicit focus list (every invariant relied on, call site moved, removal claimed complete). The charge: **explore the changes and see whether you created any bugs, didn't read enough code to make the right change and implementation, or missed something important.** Tell it to be adversarial, to state what it checked and found clean, and what it could **not** verify — green tests are not proof. Run it in the background.
- **Triage — you own the findings.** Verify each against the code yourself (the agent and its fixes can be wrong). Fix every blocker/major before the PR; add a regression test per real bug (if the suite missed it, the suite has a hole); write down anything deferred with the reason.
- **Also triage the PR's AI/bot reviews (Copilot, Claude review, ANY automated reviewer) — mandatory.** Before any merge (and after each push that draws fresh bot comments), fetch every automated review comment — line comments (`gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate`), review submission bodies (`.../pulls/<n>/reviews --paginate`), and PR-level comments (`.../issues/<n>/comments --paginate`) — and triage each like an agent finding: verify against the **current** code, fix the real ones, dismiss the rest with a reason. **Beware stale comments** pinned to a superseded sha — check `HEAD`.
- **Reply to every finding** so the human can resolve it: "fixed in `<sha>` + how" or a one-line "not worth fixing because …". Line comments are resolvable threads — reply in-thread (`gh api -X POST .../pulls/<n>/comments -f body=... -F in_reply_to=<comment_id>`); review bodies and PR-level comments are not threaded — address those in a normal PR comment.
- **Loop until the reviewers are quiet.** Each push spawns a fresh AI review; re-fetch and re-triage after every push until a fetch returns no new or unanswered comments. A green-CI PR with unread or unanswered AI comments is NOT reviewed — do not merge.

This is not "when I have doubts." The review you skip is the one that ships the bug.

---

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

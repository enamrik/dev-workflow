---
name: dfl-plan-issue
description: Generate implementation plans with properly-scoped tasks. Auto-invoked when user wants to "plan issue", "create implementation plan", "break down into tasks", "plan #N", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:get_issue, mcp:dev-workflow-tracker:generate_plan, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:list_types, mcp:dev-workflow-tracker:list_templates, mcp:dev-workflow-tracker:get_template
---

# Plan Issue Skill

## MCP Server Connection Failures (CRITICAL)

**If MCP tools return unexpected "not found" errors for data that should exist, STOP IMMEDIATELY.**

This indicates the MCP server is connected to the wrong database. **Do NOT work around it** with manual database updates, `gh` CLI, or any other method - this creates corrupt, inconsistent state.

**Action:** Tell the user: "The MCP server appears to be connected to the wrong database. Please restart your Claude session to reconnect, then we can resume."

---

## When to Invoke

- User mentions: "plan issue", "plan #N", "create implementation plan", "break down into tasks"
- User requests planning: "how should we implement this?", "what are the tasks?"
- Auto-chained from manage-issue after issue create/update
- User wants to re-plan: "regenerate plan", "update the plan"

## User Communication

**NEVER reference skill names or slash commands to users.** Users interact in natural language - they cannot invoke skills directly. Always use conversational prompts.

| ❌ Wrong                         | ✅ Right                                       |
| -------------------------------- | ---------------------------------------------- |
| "Run /dfl-work-task to start"    | "Would you like to start working on task 1?"   |
| "Use the dfl-manage-issue skill" | "I'll update the issue."                       |
| "Invoke dfl-plan-issue again"    | "I'll regenerate the plan with those changes." |

### Key Transition Prompts

**After generating a plan:**

> "Are you satisfied with this plan? Ready to start working on it?"

**After moving to backlog (user approved plan):**

> "Issue #N is now open with X task(s) ready. Would you like to start working on task 1?"

**When re-planning:**

> "I'll update the plan with those changes."

## ⚠️ TASK DEPENDENCIES - READ THIS FIRST

> **Dependencies are the MOST IMPORTANT part of a plan.** Wrong dependencies cause workers to pick up tasks before prerequisites complete, leading to broken builds and wasted effort. **You MUST analyze and set dependencies correctly.**

### The Golden Rule

**`dependsOn: []` (empty array) means "can run in parallel with everything else".**

If a task needs another task to complete first, you MUST add `dependsOn: ["other-task-id"]`. There is no implicit ordering - only explicit dependencies control task sequencing.

### Dependency Analysis Checklist (REQUIRED)

Before writing ANY tasks, answer these questions:

| Question                                                                           | If Yes → Action      |
| ---------------------------------------------------------------------------------- | -------------------- |
| Does task B use code/tables/APIs created by task A?                                | B depends on A       |
| Does task B modify files that task A creates?                                      | B depends on A       |
| Would task B fail to compile/run if task A isn't done?                             | B depends on A       |
| Do both tasks edit the same complex file(s)?                                       | One depends on other |
| Can these tasks be developed by different people simultaneously without conflicts? | No dependency needed |

### Common Dependency Patterns

| Pattern                     | Tasks                         | Dependencies                 |
| --------------------------- | ----------------------------- | ---------------------------- |
| DB → API → UI               | schema, api, ui               | api→schema, ui→api           |
| Core → Extensions           | core, ext1, ext2              | ext1→core, ext2→core         |
| Parallel features           | auth, search                  | none (independent)           |
| Validation depends on types | types-db, settings-validation | settings-validation→types-db |
| Same file, complex edits    | feature-a, feature-b          | feature-b→feature-a          |

### Anti-Pattern: Missing Dependencies

```json
{
  "tasks": [
    { "id": "schema", "title": "Add database schema", "type": "TASK" },
    { "id": "api", "title": "Implement API endpoints", "type": "FEATURE" }, // ❌ WRONG!
    { "id": "ui", "title": "Build UI", "type": "FEATURE" } // ❌ WRONG!
  ]
}
```

**What happens:** All three tasks become READY simultaneously. Worker starts `api` before `schema` is done → build fails.

**Correct version:**

```json
{
  "tasks": [
    { "id": "schema", "title": "Add database schema", "type": "TASK" },
    { "id": "api", "title": "Implement API endpoints", "type": "FEATURE", "dependsOn": ["schema"] },
    { "id": "ui", "title": "Build UI", "type": "FEATURE", "dependsOn": ["api"] }
  ]
}
```

### Dependency Verification (REQUIRED before generate_plan)

Before calling `generate_plan`, verify:

- [ ] Every task has been analyzed for dependencies
- [ ] Tasks that use outputs from other tasks have `dependsOn` set
- [ ] Only truly independent tasks have empty `dependsOn` arrays
- [ ] The dependency graph makes sense (no task can start before its prerequisites)

---

## Core Philosophy: Tasks as Deployable Units

**A task is NOT a small implementation step. A task is a COMMITABLE, DEPLOYABLE UNIT OF WORK.**

### What Makes a Good Task

1. **Complete and Releasable**: After completing the task, the system could be deployed without breaking production
2. **Includes Tests**: If behavior can be automated and asserted on, tests are part of the task (not a separate task)
3. **Single Commit**: The task represents what would be a single meaningful commit
4. **Verifiable**: Has clear acceptance criteria that can be checked

### What Makes a BAD Task

- "Write unit tests for X" (tests should be WITH the feature, not separate)
- "Add database migration" without the code that uses it
- "Create API endpoint" without validation or error handling
- "Implement feature" followed by "Add tests for feature"
- "Refactor X" followed by "Update tests for X"

### Task Boundaries - Think in Commits

Ask yourself: "Would I commit and deploy this alone?"

- A task should be something you could merge and deploy
- If you wouldn't deploy feature code without its tests, they belong in ONE task
- Database migrations + the code using them = ONE task
- API + validation + error handling + tests = ONE task (if reasonably sized)

## Information Flow from manage-issue

When chained from `manage-issue`, you may receive additional context:

- **Approach details**: Technology choices, architecture decisions (e.g., "Use passport.js", "Store in Redis")
- **Specifics**: Exact endpoints, file paths, configuration (e.g., "/auth/callback")

Incorporate these into your plan:

- **Approach details** → Go into the Plan's "approach" field and inform task design
- **Specifics** → Go into task descriptions and acceptance criteria

If no context was passed, make reasonable decisions based on the codebase patterns.

## Markdown Formatting for Plans

Plan summary and approach fields support **GitHub Flavored Markdown**:

- **Tables** for comparisons, mappings, structured data: `| Header | Header |`
- **Code blocks** with syntax highlighting: ` ```typescript `
- **Headers** for sections: `## Approach`, `### Phase 1`
- **Task lists** for checklists: `- [x] done` / `- [ ] pending`
- **Bold/italic** for emphasis
- **Bullet/numbered lists** for steps

**Use tables when appropriate:**

- Comparing approaches or technologies
- Mapping components to responsibilities
- Showing file → change summaries
- Status/phase breakdowns

**Example approach with table:**

```markdown
## Approach

| Phase | Focus        | Components                   |
| ----- | ------------ | ---------------------------- |
| 1     | Core auth    | OAuth handler, session store |
| 2     | User profile | API endpoint, UI components  |

We'll use passport.js for OAuth handling...
```

Clarity beats decoration - use visuals when they genuinely help.

## Plan Completeness (Session Continuity)

> **A plan must be complete enough for a fresh Claude session to execute without the original conversation context.**

Plans are often created in one session and executed in another. The executing session has NO access to the conversation that led to the plan. Everything needed must be in the plan itself.

### Summary Field

Brief statement of WHAT we're building. 1-2 sentences max.

Example: "Redesign the types system to support user-defined types with soft delete and template descriptions for intelligent selection."

### Approach Field (CRITICAL)

The approach captures everything a future session needs. Include:

#### 1. Design Decisions Table

Document key decisions and WHY they were made:

| Decision       | Choice                 | Rationale                             |
| -------------- | ---------------------- | ------------------------------------- |
| Type storage   | Database, not files    | Need soft delete, validation          |
| Type scope     | Universal              | Same vocabulary across all projects   |
| FK constraints | None - store as string | History resilience when types deleted |
| Template scope | Local + Global         | Projects can override user defaults   |

#### 2. Current State

What exists NOW that changes (fresh session won't know the codebase):

- `TypeDomainService` reads from `types.md` files (which are never created by init)
- `VALID_ISSUE_TYPES` hardcoded in `type-service.ts:31` restricts valid types
- Templates at `~/.track/config/templates/` (changing to `~/.track/templates/`)

#### 3. Edge Cases

Expected behavior in unusual situations:

- Creating type with existing name → Error "Type already exists"
- Deleting default type (e.g., FEATURE) → Allowed (soft delete)
- Issue references deleted type → Still displays, can't use for new issues

#### 4. Data Structures

Include full schemas when creating new tables/types:

| Field               | Type     | Notes                  |
| ------------------- | -------- | ---------------------- |
| id                  | string   | UUID                   |
| name                | string   | Unique, e.g., "SPIKE"  |
| displayName         | string   | e.g., "Spike"          |
| description         | string   | Helps Claude pick type |
| keywords            | string[] | For auto-detection     |
| color               | string?  | UI display             |
| isDeleted           | boolean  | Soft delete            |
| createdAt/updatedAt | Date     | Timestamps             |

### Task implementationPlan Field

Goes DEEPER than approach for the specific task. Include:

- Exact file paths to create/modify
- Functions/classes with signatures
- Code patterns to follow (reference specific existing files)
- Test locations and patterns
- Order of operations within the task

**Example showing expected detail level:**

```
1. Create types table in packages/database/src/schema.ts
   - Add after tasks table
   - Columns: id, name (unique), displayName, description, keywords (JSON), color, isDeleted, deletedAt, createdAt, updatedAt

2. Create SqliteTypeRepository in packages/tracking/src/types/type-repository.ts
   - Follow SqliteIssueRepository pattern
   - Methods: create, update, softDelete, findByName, findAll, findActive

3. Update TypeDomainService in packages/tracking/src/types/type-service.ts
   - Remove VALID_ISSUE_TYPES hardcoded set (line 31)
   - Change loadTypes() to read from DB via repository
   - Add create/update/delete methods delegating to repository

4. Add MCP tools in apps/mcp-server/src/tools/type-tools.ts
   - create_type, update_type, delete_type

5. Tests in packages/tracking/src/types/__tests__/
   - type-repository.test.ts, update type-service.test.ts
```

### Approach Checklist

- [ ] Design decisions with rationale (WHY, not just what)
- [ ] Current state (what exists now that changes)
- [ ] Edge cases and expected behaviors
- [ ] Full schemas if creating new data structures
- [ ] Detailed implementationPlan for each task

## Task Templates and Story Format

**Task content is separated into two concerns:**

| Field                | Purpose                        | Syncs to GitHub? |
| -------------------- | ------------------------------ | ---------------- |
| `description`        | Human-readable story format    | ✓ Yes            |
| `acceptanceCriteria` | Verifiable outcomes for humans | ✓ Yes            |
| `implementationPlan` | Technical details for Claude   | ✗ No             |

### Using Task Templates

Call `list_templates(category: 'task')` to see available task templates. Templates provide consistent story format structure for different task types (feature, bug, enhancement, task).

**Workflow:**

1. **Get task template** - Call `get_template(filename, category: 'task')` for the task's type
2. **Write story format** - Use the template structure for `description` and `acceptanceCriteria`
3. **Add technical details** - Put implementation specifics in `implementationPlan`

### Story Format (description + acceptanceCriteria)

Write for **humans reading GitHub issues**:

- Clear, non-technical language where possible
- What the user/system will be able to do
- Verifiable outcomes (not implementation steps)

**Good story format:**

```
Description: Users can sign in with their Google account and maintain
their session across browser refreshes.

Acceptance Criteria:
- User can click "Sign in with Google" and complete OAuth flow
- Session persists after closing and reopening the browser
- Expired sessions show a clear re-authentication prompt
```

### Implementation Plan (implementationPlan)

Write for **Claude executing the task**:

- Specific file paths and patterns to use
- Technical approach and architecture decisions
- Code patterns to follow from existing codebase
- Edge cases and error handling strategy

**Good implementation plan:**

```
Use passport.js with GoogleStrategy. Follow the existing auth pattern in
src/middleware/auth.ts. Store sessions in Redis using connect-redis.
Token refresh should use the pattern from src/services/token-service.ts.
Add unit tests to src/__tests__/auth/ following existing test patterns.
```

### Why This Separation Matters

- **GitHub issues stay readable** - Product managers and stakeholders see clear requirements, not technical jargon
- **Claude has execution context** - Technical details are preserved for task execution without cluttering the user-facing issue
- **Templates ensure consistency** - Story format follows project conventions

## Process

1. **Get Issue Context:**
   - Call `get_issue` with the issue number
   - Read the issue title, description, and acceptance criteria
   - **Check the issue type** - if it's a BUG or SPIKE, use the single-task approach (see below)

2. **For BUG or SPIKE Issues - Use Single-Task Approach:**
   - **BUG**: Generate ONE task: "Investigate and fix: [bug title]"
   - **SPIKE**: Generate ONE task: "Spike: [spike title]"
   - Skip to step 8 (Generate Plan)

3. **Get Available Types:**
   - Call `list_types` to get the valid type list
   - You MUST use types from this list - **invalid types will be rejected**

4. **Analyze Scope and Design Tasks:**
   - Identify natural task boundaries (different subsystems, different APIs)
   - Design tasks as deployable units (see Core Philosophy section)
   - Estimate complexity: 1 task = LOW, 2-3 = MEDIUM, 4-5 = HIGH, 5+ = VERY_HIGH

5. **⚠️ ANALYZE DEPENDENCIES (CRITICAL):**

   **STOP and do this analysis before proceeding:**

   For each pair of tasks, ask:
   - Does task B use code/tables/APIs created by task A? → B depends on A
   - Would task B fail to compile if task A isn't done? → B depends on A
   - Can both tasks be worked on simultaneously without conflicts? → No dependency

   **Write out your dependency analysis explicitly:**

   ```
   Dependency Analysis:
   - Task "api" uses the schema from task "db" → api depends on db
   - Task "validation" needs TypeDomainService from task "types" → validation depends on types
   - Tasks "templates" and "types" are independent → no dependency
   ```

   **If you skip this step, workers will pick up tasks in wrong order.**

6. **Write Task Definitions:**
   Each task needs:
   - **id**: Short placeholder (e.g., "db", "api")
   - **title**: Verb phrase describing the deliverable
   - **description**: Human-readable (syncs to GitHub)
   - **type**: From step 3 (FEATURE, BUG, ENHANCEMENT, TASK, SPIKE)
   - **acceptanceCriteria**: Verifiable outcomes
   - **dependsOn**: Array of task IDs this depends on (from step 5)
   - **implementationPlan** (optional): Technical details for Claude

7. **Verify Dependencies Before Generating:**

   **Checklist (all must be true):**
   - [ ] Every task analyzed for dependencies in step 5
   - [ ] Tasks using other tasks' outputs have `dependsOn` set
   - [ ] Only truly parallel tasks have empty `dependsOn`

   **If any task should wait for another, it MUST have `dependsOn` set.**

8. **Generate Plan:**
   - Call `generate_plan` with issueNumber, summary, approach, and tasks
   - Verify the tasks array includes `dependsOn` for each task
   - Display the issue URL from the response

9. **Ask User to Confirm Plan:**
   - Show the plan summary and task dependencies
   - Ask: "Are you satisfied with this plan? Ready to start working on it?"
   - Wait for explicit approval before proceeding

10. **Start Work on Confirmation:**
    - Call `move_issue_to_backlog` with the issue number
    - This transitions: Issue PLANNED → OPEN, Tasks PLANNED → BACKLOG

## When a Single Task is Enough

Many issues need only ONE task. This is perfectly fine and often correct:

- Simple bug fixes (fix + test = 1 task)
- Small features contained to one module
- Refactoring with test updates
- Configuration changes with verification

**Do NOT artificially split work into multiple tasks.** If it's one deployable unit, it's one task.

## When to Split into Multiple Tasks

Split when:

- Different parts can genuinely be deployed independently
- Different parts touch completely separate subsystems
- One part is blocked waiting for external dependencies
- The scope is large enough that multiple commits make sense

## Re-Planning (Regenerating Plans)

When a user wants to update a plan ("regenerate plan", "update the plan", "add a task"), simply call `generate_plan` again with the updated task list. The system handles everything automatically:

### Automatic Task Preservation

- **IN_PROGRESS and COMPLETED tasks are always preserved** - they cannot be removed or modified by regeneration
- **PLANNED, BACKLOG, and READY tasks** are matched against new tasks by title similarity
- Matched tasks are updated in place; unmatched old tasks are soft-deleted

### How Matching Works

- Tasks are matched using fuzzy title matching (Levenshtein distance)
- A match threshold of 80% similarity is used
- This prevents duplicate tasks when regenerating with slightly different wording

### What This Means for You

1. **To add a task**: Include it in your new task list alongside existing tasks
2. **To modify a task**: Include the updated version - it will match and update
3. **To remove a task**: Simply omit it from the new task list (only works for PLANNED/BACKLOG/READY tasks)
4. **No manual task management needed**: Just regenerate with the desired final state

## Bug Issues: Single-Task Investigation Approach

**Bugs are inherently exploratory.** You don't know the solution until you've investigated the root cause. Creating a multi-task plan for bugs is backwards - you'd be planning a solution before understanding the problem.

### Bug Planning Rules

When the issue type is **BUG**:

1. **Always create a SINGLE task** with the title pattern: `Investigate and fix: [bug title]`
2. **Do NOT attempt to break down into multiple tasks** - the scope is unknown until investigation
3. **Task description** should reference the symptoms and reproduction steps from the issue
4. **Acceptance criteria** should include:
   - Bug is fixed and verified
   - Root cause is documented (in task progress log)
   - Tests added to prevent regression

### Why Single-Task for Bugs?

- **Investigation IS the work**: You can't separate "find the bug" from "fix the bug" - they're one continuous flow
- **Scope is unknown**: A bug might be a one-line fix or require refactoring multiple files - you don't know until you look
- **Premature planning wastes effort**: Any multi-task breakdown would need revision after investigation anyway
- **Task progress log captures the journey**: Use `log_task_progress` during execution to document findings, root cause, and fix applied

### Bug Task Template

**Title:** Investigate and fix: [bug title from issue]

**Description:**
Investigate and resolve the reported issue. Document findings in task progress log.

Symptoms: [from issue description]
Reproduction: [from issue steps to reproduce]

**Acceptance Criteria:**

- [ ] Bug is fixed and verified with reproduction steps
- [ ] Root cause documented in task progress log
- [ ] Regression test added to prevent recurrence

## SPIKE Issues: Single-Task Exploration

**SPIKEs are timeboxed exploratory work where discovery happens during implementation.** The goal is learning and documenting findings, not shipping a predefined solution. Creating detailed task breakdowns for SPIKEs is counterproductive since the scope is inherently uncertain.

### SPIKE Planning Rules

When the issue type is **SPIKE**:

1. **Always create a SINGLE task** with the title pattern: `Spike: [issue title]`
2. **Do NOT attempt to break down into multiple tasks** - the exploration is the work
3. **Task description** should reference the research goals and questions from the issue
4. **Acceptance criteria** should focus on:
   - Documenting findings and learnings
   - Capturing any prototypes or proof-of-concepts created
   - Providing recommendations for next steps
5. **Set complexity to LOW** - SPIKEs are timeboxed, not scope-boxed

### Why Single-Task for SPIKEs?

- **Exploration IS the work**: You can't plan discovery - that defeats the purpose
- **Scope emerges**: What you learn determines what's worth building next
- **Timeboxed by nature**: A SPIKE succeeds by producing knowledge within a timebox, not by completing predefined tasks
- **Findings inform future work**: The output is typically new issues/tasks based on learnings

### SPIKE Task Template

**Title:** Spike: [spike title from issue]

**Description:**
Explore and investigate the topic. Document all findings, decisions, and recommendations.

Goals: [from issue description]
Questions to answer: [from issue acceptance criteria]

**Acceptance Criteria:**

- [ ] Research goals addressed with documented findings
- [ ] Key learnings captured in task progress log or PR description
- [ ] Recommendations provided for follow-up work (if applicable)
- [ ] Any prototypes/proof-of-concepts committed (if created)

## Complexity Estimation

- **LOW**: 1 task, straightforward, single component
- **MEDIUM**: 1-3 tasks, moderate scope, few components
- **HIGH**: 3-5 tasks, significant scope, multiple components
- **VERY_HIGH**: 5+ tasks, large scope, system-wide changes

## Task Structure Guidelines

### Good Task Example

**Title:** Add OAuth2 authentication with Google provider

**Description:**
Implement Google OAuth2 authentication flow including:

- OAuth callback handler
- User session creation
- Token refresh logic
- Error handling for auth failures

Includes unit tests for token handling and integration tests for the OAuth flow.

**Acceptance Criteria:**

- [ ] User can sign in with Google
- [ ] Session persists across browser refresh
- [ ] Expired tokens trigger re-authentication
- [ ] Unit tests pass for token service (>80% coverage)
- [ ] Integration test covers happy path and error cases

### Bad Task Example (DO NOT DO THIS)

Task 1: "Add OAuth callback handler"
Task 2: "Add session management"
Task 3: "Write tests for OAuth" ← WRONG: Tests should be in Task 1!
Task 4: "Add error handling" ← WRONG: Should be part of the feature!

## Example Plan Output

**User:** "Plan issue #1 - Add user authentication with OAuth"

```
Analyzing issue #1: Add user authentication with OAuth

Implementation context: passport.js, Redis sessions, /auth/callback

MEDIUM complexity - 2 deployable tasks:

## Plan Summary
Implement OAuth authentication using passport.js with Redis session storage.

## Approach
| Phase | Focus | Components |
|-------|-------|------------|
| 1 | Core auth | OAuth handler, token management |
| 2 | Sessions | Redis storage, user profile API |

## Tasks

### Task 1: Implement OAuth2 authentication with passport.js (with tests)
- Passport strategy for Google OAuth
- Callback handler at /auth/callback
- Token management and error handling
- Unit + integration tests

### Task 2: Add Redis session storage and user profile (with tests)
- Session persistence with configurable TTL
- /api/me endpoint
- Tests for session expiry

---
Plan generated. **Issue URL:** http://127.0.0.1:3456/projects/{projectId}/issues/1

**Are you satisfied with this plan? Ready to start working on it?**
```

**For single-task plans:** Same structure, just one task.
**For bug issues:** Single task titled "Investigate and fix: [bug title]" with symptoms and reproduction steps.

## Error Handling

If issue not found:

- Explain the error
- Suggest checking the issue number with `search_issues`

If issue has no description/acceptance criteria:

- Ask the user for more context before planning
- Suggest updating the issue first with manage-issue

## Task Types (REQUIRED)

Every task **MUST** have a `type` field. The type determines the GitHub label applied when the task is synced to GitHub.

**Step 1: Always call `list_types` first** to get the valid type list. This returns types with their descriptions and GitHub label mappings.

**Step 2: Select the appropriate type** for each task based on its content:

| Type            | Use When                                               | GitHub Label  |
| --------------- | ------------------------------------------------------ | ------------- |
| **FEATURE**     | Task adds new functionality that doesn't exist yet     | `feature`     |
| **BUG**         | Task fixes something broken or not working as expected | `bug`         |
| **ENHANCEMENT** | Task improves existing functionality                   | `enhancement` |
| **TASK**        | Technical work, chores, infrastructure, maintenance    | `task`        |
| **SPIKE**       | Timeboxed research/investigation; goal is learning     | `spike`       |

**Type Selection Guidance:**

- **FEATURE**: "Add user authentication", "Implement payment processing", "Create dashboard page"
- **BUG**: "Fix login timeout error", "Resolve memory leak", "Investigate and fix: [bug title]"
- **ENHANCEMENT**: "Improve search performance", "Refactor database queries", "Optimize image loading"
- **TASK**: "Set up CI/CD pipeline", "Update dependencies", "Configure logging", "Add database migration"
- **SPIKE**: "Research OAuth providers", "Prototype caching strategy", "Investigate performance bottleneck", "Explore new framework"

**Example generate_plan call with types and implementationPlan:**

```typescript
generate_plan({
  issueNumber: 5,
  summary: "Add user authentication with OAuth",
  approach: "Implement OAuth2 flow using passport.js...",
  estimatedComplexity: "MEDIUM",
  tasks: [
    {
      id: "auth",
      title: "Implement OAuth2 authentication with passport.js",
      // Story format (syncs to GitHub):
      description:
        "Users can sign in with their Google account and maintain their session across browser refreshes.",
      type: "FEATURE",
      acceptanceCriteria: [
        "User can click 'Sign in with Google' and complete OAuth flow",
        "Session persists after closing and reopening the browser",
        "Expired sessions show a clear re-authentication prompt",
      ],
      // Technical details (NOT synced to GitHub):
      implementationPlan:
        "Use passport.js with GoogleStrategy. Follow existing auth pattern in src/middleware/auth.ts. Store sessions in Redis using connect-redis. Token refresh should use pattern from src/services/token-service.ts. Add unit tests to src/__tests__/auth/.",
    },
    {
      id: "session",
      title: "Add Redis session storage",
      description: "Session data is persisted in Redis for reliability and scalability.",
      type: "TASK",
      acceptanceCriteria: [
        "Sessions stored in Redis instead of memory",
        "Session TTL is configurable via environment variable",
      ],
      implementationPlan:
        "Use connect-redis with existing Redis connection from src/config/redis.ts. Add SESSION_TTL env var defaulting to 24 hours. Update src/middleware/session.ts.",
      dependsOn: ["auth"],
    },
  ],
});
```

**Note:** If a task type is missing or invalid, `generate_plan` will reject the request.

**Key distinction:**

- `description` + `acceptanceCriteria` → Human-readable story format, syncs to GitHub issues
- `implementationPlan` → Technical details for Claude execution, NOT synced to GitHub

## Notes

- **Fewer, well-defined tasks > many granular tasks**
- Tests are NOT separate tasks - they're part of the feature
- A plan with 1 task is valid and often correct
- Consider the developer experience: would YOU want to work on this task as defined?
- When in doubt, combine rather than split

---
name: dwf-plan-issue
description: Generate implementation plans with properly-scoped tasks. Auto-invoked when user wants to "plan issue", "create implementation plan", "break down into tasks", "plan #N", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:get_issue, mcp:dev-workflow-tracker:generate_plan, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:list_types
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

The plan summary and approach fields support **GitHub Flavored Markdown**. Use rich formatting to make plans clear and scannable:

**Available formatting:**
- **Tables** for comparisons, mappings, or structured data: `| Header | Header |`
- **Task lists** for checklists: `- [x] done` / `- [ ] pending`
- **Strikethrough** for deprecated/removed items: `~~old approach~~`
- **Code blocks** with syntax highlighting: ` ```typescript `
- **Headers** for sections: `## Approach`, `### Phase 1`
- **Bold/italic** for emphasis
- **Bullet/numbered lists** for steps or options

**Use tables when appropriate:**
- Comparing approaches or technologies
- Mapping components to responsibilities
- Showing file → change summaries
- Status/phase breakdowns

**Example approach with table:**
```markdown
## Approach

| Phase | Focus | Components |
|-------|-------|------------|
| 1 | Core auth | OAuth handler, session store |
| 2 | User profile | API endpoint, UI components |

We'll use passport.js for OAuth handling...
```

Don't overuse formatting—clarity beats decoration. Use visuals when they genuinely help communicate the plan structure.

## Process

1. **Get Available Types (REQUIRED):**
   - Call `list_types` to get the valid type list
   - This returns all available types with their descriptions and GitHub label mappings
   - You MUST use types from this list when defining tasks - **invalid types will be rejected**
   - Store this information for step 7

2. **Get Issue Context:**
   - Call `get_issue` with the issue number
   - Read the issue title, description, and acceptance criteria
   - Note any implementation context passed from manage-issue
   - **Check the issue type** - if it's a BUG, use the single-task investigation approach (see "Bug Issues" section below)

3. **For BUG Issues - Use Single-Task Approach:**
   - Skip multi-task planning entirely
   - Generate ONE task: "Investigate and fix: [bug title]"
   - Include symptoms and reproduction steps in description
   - Set complexity to LOW
   - Proceed to step 7 (Generate Plan)

4. **Analyze Scope and Complexity (non-bug issues):**
   - Consider what files/components will be touched
   - Identify natural boundaries (different subsystems, different APIs)
   - Incorporate any technology choices from the context
   - Estimate if this is a 1-task or multi-task issue

5. **Design Tasks as Deployable Units:**
   For each potential task, ask:
   - Can this be deployed independently without breaking prod?
   - Does it include all necessary tests?
   - Would this make sense as a single commit message?
   - Is anything missing that would cause issues if deployed?

6. **Write Clear Task Definitions:**
   Each task should have:
   - **Title**: Verb phrase describing the deliverable (e.g., "Add user authentication with session management")
   - **Description**: What will be implemented AND tested
   - **Type**: One of the valid types from step 1 (e.g., FEATURE, BUG, ENHANCEMENT, TASK)
   - **Acceptance Criteria**: Specific, verifiable outcomes (include test expectations)

7. **Generate Plan:**
   - Call `generate_plan` with `issueNumber` (from step 2), summary, approach, and tasks
   - **Each task MUST include a `type` field** with a valid type from step 1
   - Use appropriate complexity estimate (LOW, MEDIUM, HIGH, VERY_HIGH)
   - **Tasks are created in PLANNED status** (no GitHub sync yet)
   - **Display the issue URL** from the `generate_plan` response (the `url` field)

8. **Ask if User is Satisfied with the Plan (REQUIRED):**
   - **NEVER automatically start work.** Always ask the user if they're satisfied with the plan first.
   - Show the issue URL so the user can view the full details in the web UI
   - Present the plan summary and ask: "Are you satisfied with this plan? Ready to start working on it?"
   - Wait for explicit user approval before calling `move_issue_to_backlog`

9. **Start Work on Confirmation:**
   - Only after user confirms, call `move_issue_to_backlog` with the issue number
   - This transitions: Issue PLANNED → OPEN, Tasks PLANNED → BACKLOG
   - If GitHub sync is enabled, creates GitHub issues for each task
   - **To skip GitHub sync:** If user explicitly requests no GitHub issues (e.g., "don't create GitHub issues", "skip GitHub sync"), call `move_issue_to_backlog` with `skipGitHubSync: true`

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

### Example: Adding a Task to Existing Plan

If issue #5 has tasks ["Set up database", "Add API endpoints"] and user wants to add "Add admin dashboard":

```
Call generate_plan with tasks:
1. "Set up database" (matches existing, preserved)
2. "Add API endpoints" (matches existing, preserved)
3. "Add admin dashboard" (new task, created)
```

The system matches tasks 1 and 2 to existing tasks and creates task 3 as new.

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

### With Implementation Context from manage-issue

**Context passed:** "Use passport.js, store sessions in Redis, callback at /auth/callback"

**User:** "Plan issue #1 - Add user authentication with OAuth"

**Response:**

```
Analyzing issue #1: Add user authentication with OAuth

Implementation context noted:
- Library: passport.js
- Session storage: Redis
- Callback endpoint: /auth/callback

This is a MEDIUM complexity feature. Based on requirements and implementation
preferences, I recommend 2 deployable tasks:

## Plan Summary
Implement OAuth authentication using passport.js with Redis session storage.

## Approach
Using passport.js for OAuth handling (as specified), with Redis for session
persistence. The implementation will be done in two deployable phases:
1. Core OAuth2 authentication with passport.js
2. Redis session persistence and user profile

## Tasks

### Task 1: Implement OAuth2 authentication with passport.js (with tests)
Add the complete OAuth2 flow using passport.js including:
- Passport strategy configuration for Google OAuth
- Callback handler at /auth/callback
- Token management and refresh logic
- Error handling for auth failures

Includes unit tests for passport strategy and integration tests for OAuth flow.

**Acceptance Criteria:**
- OAuth callback at /auth/callback processes Google auth correctly
- Access tokens are securely stored
- Refresh tokens trigger automatic renewal
- Auth failures return appropriate error responses
- Unit tests achieve 80%+ coverage on auth module
- Integration test covers sign-in flow end-to-end

### Task 2: Add Redis session storage and user profile (with tests)
Implement session persistence using Redis, user profile storage, and the
"current user" API endpoint. Includes tests for session expiry and lookup.

**Acceptance Criteria:**
- Sessions stored in Redis with configurable TTL
- Sessions persist across browser refresh
- User profile accessible via /api/me endpoint
- Session expiry triggers re-authentication prompt
- Tests cover Redis connection failures gracefully

---
Plan generated with 2 tasks in PLANNED status.

**Issue URL:** http://127.0.0.1:3456/projects/{projectId}/issues/1

**Are you satisfied with this plan? Ready to start working on it?**
(I'll create GitHub issues for each task when you confirm)
```

### Without Implementation Context (standalone invocation)

**User:** "Plan issue #5 - Add caching to API responses"

**Response:**

```
Analyzing issue #5: Add caching to API responses

No specific implementation preferences provided. Based on the codebase patterns
(I see you're using Express with TypeScript), I'll design an approach.

This is a LOW complexity feature - can be done in 1 deployable task.

## Plan Summary
Add response caching to improve API performance.

## Approach
Implement in-memory caching (can upgrade to Redis later if needed).
Single task since caching + tests is one deployable unit.

## Tasks

### Task 1: Add API response caching with cache invalidation (with tests)
Implement caching middleware for GET endpoints with:
- Configurable TTL per route
- Cache key generation from request params
- Cache invalidation on mutations
- Tests for cache hits, misses, and invalidation

**Acceptance Criteria:**
- GET requests return cached responses when available
- Cache invalidates on POST/PUT/DELETE
- Cache TTL is configurable per route
- Tests verify caching behavior and edge cases

---
Plan generated with 1 task in PLANNED status.

**Issue URL:** http://127.0.0.1:3456/projects/{projectId}/issues/5

**Are you satisfied with this plan? Ready to start working on it?**
(I'll create a GitHub issue for the task when you confirm)
```

### Bug Issue (Single-Task Investigation)

**User:** "Plan issue #7 - Login fails silently when session expires"

**Response:**

```
Analyzing issue #7: Login fails silently when session expires

This is a BUG issue. Using single-task investigation approach - the solution
will be discovered during investigation, not planned upfront.

## Plan Summary
Investigate and fix the silent login failure on session expiry.

## Approach
Investigation-first: identify root cause through debugging, then implement
fix with regression test. Findings will be documented in task progress log.

## Tasks

### Task 1: Investigate and fix: Login fails silently when session expires
Investigate and resolve the reported issue. Document findings in task progress log.

Symptoms: Users report being stuck on login page with no error message when
their session has expired. Expected behavior is a clear "Session expired"
message prompting re-authentication.

Reproduction:
1. Log in successfully
2. Wait for session to expire (or manually invalidate)
3. Attempt any authenticated action
4. Observe: redirected to login with no message

**Acceptance Criteria:**
- [ ] Bug is fixed and verified with reproduction steps
- [ ] Root cause documented in task progress log
- [ ] Regression test added to prevent recurrence

---
Plan generated with 1 task in PLANNED status.

**Issue URL:** http://127.0.0.1:3456/projects/{projectId}/issues/7

**Are you satisfied with this plan? Ready to start working on it?**
(I'll create a GitHub issue for the task when you confirm)
```

## Error Handling

If issue not found:

- Explain the error
- Suggest checking the issue number with `search_issues`

If issue has no description/acceptance criteria:

- Ask the user for more context before planning
- Suggest updating the issue first with manage-issue

## Task IDs and Dependencies

When calling `generate_plan`, use **short placeholder IDs** for tasks instead of UUIDs. The tool generates real UUIDs internally.

**Example with dependencies and types:**

```json
{
  "tasks": [
    { "id": "db", "title": "Set up database schema", "description": "...", "type": "TASK" },
    {
      "id": "api",
      "title": "Add API endpoints",
      "description": "...",
      "type": "FEATURE",
      "dependsOn": ["db"]
    },
    {
      "id": "ui",
      "title": "Build UI components",
      "description": "...",
      "type": "FEATURE",
      "dependsOn": ["api"]
    }
  ]
}
```

**Guidelines:**

- Use short, descriptive IDs: `"db"`, `"api"`, `"auth"`, `"tests"`
- Reference dependencies by their placeholder ID
- All `dependsOn` references must match an `id` in the tasks array
- For single-task plans, the ID can be anything (e.g., `"main"` or `"task1"`)

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

**Type Selection Guidance:**

- **FEATURE**: "Add user authentication", "Implement payment processing", "Create dashboard page"
- **BUG**: "Fix login timeout error", "Resolve memory leak", "Investigate and fix: [bug title]"
- **ENHANCEMENT**: "Improve search performance", "Refactor database queries", "Optimize image loading"
- **TASK**: "Set up CI/CD pipeline", "Update dependencies", "Configure logging", "Add database migration"

**Example generate_plan call with types:**

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
      description: "Add complete OAuth2 flow including callback handler...",
      type: "FEATURE", // New functionality
      acceptanceCriteria: ["User can sign in with Google", "Session persists"],
    },
    {
      id: "session",
      title: "Add Redis session storage",
      description: "Implement session persistence using Redis...",
      type: "TASK", // Infrastructure work
      acceptanceCriteria: ["Sessions stored in Redis", "TTL configurable"],
      dependsOn: ["auth"],
    },
  ],
});
```

**Note:** If a task type is missing or invalid, `generate_plan` will reject the request.

## Notes

- **Fewer, well-defined tasks > many granular tasks**
- Tests are NOT separate tasks - they're part of the feature
- A plan with 1 task is valid and often correct
- Consider the developer experience: would YOU want to work on this task as defined?
- When in doubt, combine rather than split

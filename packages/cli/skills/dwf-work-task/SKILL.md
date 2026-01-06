---
name: dwf-work-task
description: Manage task execution lifecycle - start, complete, or abandon tasks. Supports 3 execution modes (isolated, branch, main) and PR-based workflow. Auto-invoked when user wants to "start task", "work on task", "complete task", "finish task", "abandon task", "create PR", "submit for review", "merge PR", "pause issue", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:load_task_session, mcp:dev-workflow-tracker:abandon_task_session, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:update_task, mcp:dev-workflow-tracker:create_pr, mcp:dev-workflow-tracker:submit_for_review, mcp:dev-workflow-tracker:complete_task, mcp:dev-workflow-tracker:get_task_pr_status, mcp:dev-workflow-tracker:pause_issue, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:log_task_progress, mcp:dev-workflow-tracker:get_task_execution_log
---

# Work Task Skill

## Critical Constraint: One Task at a Time Per Session

**Within a single Claude session, complete one task fully before starting another.**

This constraint is **per-session**, not system-wide. Multiple Claude sessions CAN work on different tasks in parallel - that's the whole point of isolated worktrees! The constraint only means:

- **This session** should not juggle multiple tasks simultaneously
- If **you** started a task earlier in this conversation, finish it before starting another
- Tasks owned by **other sessions** are irrelevant to this check

A task is only "complete" when it reaches a terminal state:

- **COMPLETED** - Work done, PR merged (or committed on main mode)
- **ABANDONED** - Work stopped, reason documented

**How to check:** If you started a task earlier in this conversation (you called `load_task_session`), check if that task is still IN_PROGRESS or PR_REVIEW before starting a new one. If you haven't started any task in this conversation, you're free to start one - even if other tasks show as IN_PROGRESS (they belong to other sessions).

This ensures:

- Clean git state (no mixed changes across tasks in this session)
- Proper worktree management (one worktree per active task per session)
- Clear audit trail (each task has a complete lifecycle)

## When to Invoke

**Starting work:**

- User mentions: "start task", "work on task", "begin task", "pick up task"
- User wants to work: "let's work on the first task", "start working on #1"
- User is ready: "I'm ready to implement", "let's begin"

**Creating a PR:**

- User mentions: "create PR", "open PR", "push and create PR"
- User finished implementation: "I've finished, create a PR"

**Submitting for review:**

- User mentions: "submit for review", "ready for review", "mark ready for review"
- User after PR created: "submit it for review now", "ready for review"

**Completing work:**

- User mentions: "complete task", "finish task", "done with task", "mark complete"
- User after PR merged: "PR is merged", "merge the PR"

**Abandoning work:**

- User mentions: "abandon task", "stop task", "cancel task"
- User blocked: "I can't continue", "this approach won't work"

**Listing available work:**

- User asks: "what tasks are available?", "what can I work on?"
- User browses: "show me the tasks", "list pending tasks"

**Checking PR status:**

- User mentions: "PR status", "check PR", "what's the PR status?"

**Pausing an issue:**

- User mentions: "pause issue", "pause work", "put issue on hold"
- User needs to switch focus: "I need to work on something else first"

## Task Lifecycle

**New tasks start in PLANNED status.** The issue and tasks remain in PLANNED until
the user is satisfied with the plan and calls `move_issue_to_backlog`. This makes
tasks available to work on, creating GitHub issues for each task (if sync enabled).

Once work begins, when the first task is started, all other BACKLOG tasks automatically
transition to READY. Both BACKLOG and READY tasks can be started.

The `pause_issue` tool moves all READY tasks back to BACKLOG, allowing you to
pause work on an issue. Starting any task again will transition remaining
BACKLOG tasks back to READY.

```
                    PLANNED (new issues/tasks start here)
                       │
                       │ (user confirms plan)
                       ▼
             move_issue_to_backlog
        (creates GitHub issues for each task)
                       │
                       ▼
                    BACKLOG
                       │
                       │ (first task started → others become READY)
                       ▼
                     READY ←── pause_issue ──┐
                       │                     │
         ┌─────────────┼─────────────┐       │
         │             │             │       │
     isolated        branch         main     │
     (default)                       │       │
         │             │             │       │
         ▼             ▼             ▼       │
    IN_PROGRESS   IN_PROGRESS   IN_PROGRESS ─┘
    (worktree)    (branch)      (main)
         │             │             │
         ▼             ▼             │
    PR_REVIEW     PR_REVIEW         │
    (submit PR)   (submit PR)       │
         │             │             │
         ▼             ▼             ▼
     COMPLETED     COMPLETED     COMPLETED
    (merge+cleanup)(merge+cleanup)(direct)

         Any status can → ABANDONED
```

### Execution Modes

**1. Isolated Mode (default)**

- Creates a git worktree + branch for parallel work
- Full PR workflow: submit for review → merge → complete
- Best for: feature work, parallel tasks, changes that need review

**2. Branch Mode**

- Creates a branch only, checks out in main repo
- Full PR workflow: submit for review → merge → complete
- Best for: sequential work, when worktrees aren't needed

**3. Main Mode**

- Works directly on main branch, no branch created
- Skips PR workflow, completes directly
- Best for: trivial fixes, documentation, config changes

### Status Transitions

| From        | To          | Trigger                                                                                                 |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| PLANNED     | BACKLOG     | `move_issue_to_backlog` (user satisfied with plan, creates GitHub issues unless `skipGitHubSync: true`) |
| BACKLOG     | IN_PROGRESS | `load_task_session` (also moves other BACKLOG → READY)                                                  |
| READY       | IN_PROGRESS | `load_task_session`                                                                                     |
| READY       | BACKLOG     | `pause_issue` (moves all READY tasks)                                                                   |
| IN_PROGRESS | IN_PROGRESS | `create_pr` (creates PR, status unchanged - isolated/branch modes)                                      |
| IN_PROGRESS | PR_REVIEW   | `submit_for_review` (after PR exists - isolated/branch modes)                                           |
| IN_PROGRESS | COMPLETED   | `complete_task` (main mode only)                                                                        |
| PR_REVIEW   | COMPLETED   | `complete_task` (after PR merged)                                                                       |
| Any         | ABANDONED   | `abandon_task_session`                                                                                  |

## Process

### To Start a Task

1. **Check if YOU have an active task in this conversation:**
   - Did you call `load_task_session` earlier in this conversation?
   - If yes, is that task still IN_PROGRESS or PR_REVIEW?
   - If you have an active task → remind user to complete or abandon it first
   - If you haven't started any task in this conversation → proceed freely
   - **Important:** Tasks owned by other sessions are irrelevant - multiple sessions can work in parallel

2. **Identify the task:**
   - If user specified a task → use that task ID
   - If not specified → call `list_available_tasks` and help user choose
   - If only one task available → confirm and start it

3. **Check task status:**
   - **If task is PLANNED:** The plan hasn't been approved yet.
     - Ask the user: "This task is still planned. Are you satisfied with the plan? Ready to start working on it?"
     - If user confirms → call `move_issue_to_backlog` to make tasks available
     - This transitions all PLANNED tasks to BACKLOG and creates GitHub issues (unless user requests `skipGitHubSync: true`)
   - **If task is BACKLOG or READY:** Proceed with starting

4. **Determine execution mode:**
   - **ALWAYS use `isolated` mode** unless the user explicitly requests otherwise
   - Only use `branch` if user explicitly says "branch mode", "no worktree", etc.
   - Only use `main` if user explicitly says "on main", "main mode", "skip PR", etc.
   - **NEVER autonomously choose a non-default mode** based on task complexity or size

5. **Load the task session:**
   - Call `load_task_session` with task ID, session ID, and mode
   - This returns full context: task, issue, plan, worktree info
   - If task is already IN_PROGRESS, it resumes the existing session
   - Review title, description, and acceptance criteria from the response

6. **If resuming (task was already IN_PROGRESS):**
   - Call `get_task_execution_log` to read previous session's progress
   - Review the logged entries to understand what was already done
   - Summarize the previous progress to the user before continuing
   - Check `git status` in the worktree to see uncommitted changes
   - Continue from where the previous session left off

7. **Present task to user:**
   - Show what needs to be implemented
   - Show acceptance criteria as a checklist
   - For isolated mode: show worktree path and branch name
   - For branch mode: show branch name
   - For main mode: note that PR will be skipped
   - Offer to begin implementation

### To Create a PR and Submit for Review (Isolated/Branch Modes)

After implementing the task, create a PR and optionally submit for review.

**Important:** This is a two-step process to avoid race conditions with GitHub Projects:

1. `create_pr` - Creates the PR, GitHub's automation sets "In progress" column
2. `submit_for_review` - Transitions to PR_REVIEW, sets "In review" column

#### Step 1: Create the PR

1. **Summarize work done:**
   - List the key changes made (files modified, features added)
   - Review acceptance criteria against what was implemented
   - Show which criteria are met

2. **Run validation steps:**
   - Check context (CLAUDE.md, project docs) for required validation
   - Run any tests, linting, build, or other quality checks mentioned
   - Common validations: `make test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
   - If validation fails → fix issues before proceeding

3. **Commit all local changes:**
   - **IMPORTANT:** You must commit before rebasing - git rebase fails with uncommitted changes
   - Run `git status` to check for uncommitted changes
   - Stage all changes related to the task
   - Create a commit with a clear message describing the work done
   - Include task context in commit message (e.g., "Implement X for issue #N")

4. **Rebase on latest main:**
   - Fetch and rebase on the latest main branch before pushing
   - Run: `git fetch origin main && git rebase origin/main`
   - If conflicts occur:
     - Attempt to resolve them automatically based on the task context
     - Use `git add <resolved-files>` and `git rebase --continue`
     - If a conflict is ambiguous or risky, ask the user for guidance
   - After rebase completes, **re-run full validation** (check CLAUDE.md, package.json scripts, or Makefile for the project's validation commands)
   - If validation fails after conflict resolution, fix the issues before proceeding
   - **Why:** Ensures your PR is up-to-date with main, reduces merge conflicts, and catches integration issues early

5. **Create the PR:**
   - Call `create_pr` with task ID
   - This pushes the branch and creates the PR with GitHub issue linking
   - **Task status stays IN_PROGRESS** - this is intentional to let GitHub's automation set "In progress" first
   - Show the PR URL to user

6. **Report PR created:**
   - PR is open but task is still IN_PROGRESS
   - Ask user: "PR created. Would you like to submit it for review now?"

#### Step 2: Submit for Review

When user confirms they want to submit for review:

1. **Submit for review:**
   - Call `submit_for_review` with task ID
   - This transitions task status to PR_REVIEW and syncs to GitHub's "In review" column
   - No race condition since GitHub's automation already ran when PR was created

2. **Report status:**
   - Task is now in PR_REVIEW
   - PR is open and ready for review
   - User can still push changes to the PR branch (see below)

### Pushing Additional Changes to a PR

When user needs to push more changes (e.g., review feedback):

1. Make the requested changes
2. Rebase on main and re-run validation (same as PR creation step 4)
3. Commit and push: `git push` (or `git push --force-with-lease` after rebase)

### To Complete a Task

**IMPORTANT: `complete_task` requires a `finalLogEntry` parameter** - a summary of what was accomplished. This ensures every completed task has documentation of the work done.

**For Main Mode (no PR):**

1. **Summarize work done:**
   - List the key changes made
   - Review acceptance criteria

2. **Ask for confirmation:**
   - Present summary to user
   - Ask: "Should I mark this task as complete?"
   - Wait for explicit user approval

3. **Run validation and commit:**
   - Run tests/linting
   - Create git commit

4. **Complete the task:**
   - Call `complete_task` with task ID, session ID, and `finalLogEntry`
   - The `finalLogEntry` should summarize what was accomplished (files changed, features added, etc.)
   - Task transitions directly to COMPLETED

**For Isolated/Branch Modes (with PR):**

1. **Verify PR is merged:**
   - Check PR status with `get_task_pr_status`
   - If not merged → tell user to merge the PR first
   - If merged → proceed

2. **Complete the task:**
   - Call `complete_task` with task ID, session ID, and `finalLogEntry`
   - The `finalLogEntry` should summarize what was accomplished
   - This atomically: writes final log, verifies PR merged, pulls main, cleans up worktree/branch
   - Task transitions to COMPLETED

3. **Report completion:**
   - Show task is now COMPLETED
   - Suggest next steps (next task, or done with issue)

### To Abandon a Task

1. **Confirm abandonment:**
   - Ask user for the reason
   - Confirm they want to abandon (work will be lost for isolated/branch modes)

2. **Abandon the session:**
   - Call `abandon_task_session` with task ID, session ID, and reason
   - For isolated/branch modes: worktree and branch will be deleted

3. **Report and suggest:**
   - Show task is now ABANDONED
   - Suggest alternatives (different approach, re-plan issue)

### To Pause an Issue

Pausing an issue moves all READY tasks back to BACKLOG, allowing work to be
temporarily put on hold. This is useful when switching focus to another issue.

1. **Pause the issue:**
   - Call `pause_issue` with the issue number
   - All READY tasks will move to BACKLOG

2. **Report results:**
   - Show how many tasks were moved
   - Explain that starting any task will resume work on the issue

3. **When work resumes:**
   - Starting any BACKLOG or READY task will transition all BACKLOG tasks to READY
   - Work resumes on the issue

**Note:** IN_PROGRESS, PR_REVIEW, COMPLETED, and ABANDONED tasks are not affected
by pause. Only READY tasks are moved.

## CRITICAL: Worktree Path (Isolated Mode)

When a task is started in isolated mode, `load_task_session` returns a `worktreePath`. You MUST use this path for ALL file operations during the task:

- **Read/Edit/Write tools**: Always use the full worktree path (e.g., `/Users/.../.track/project/worktrees/issue-N-task-N/path/to/file`)
- **Bash commands**: Always `cd` to the worktree path or use absolute paths within the worktree
- **Glob/Grep tools**: Always specify the worktree path in the `path` parameter

**NEVER** fall back to the main repo path. The main repo may be on a different branch or have different content. All changes for the PR must be made in the worktree.

```
❌ Read("/Users/user/code/project/Makefile")           # Main repo - WRONG
✅ Read("/Users/user/.track/project/worktrees/issue-1-task-1/Makefile")  # Worktree - CORRECT
```

## Example Interactions

### Starting a Task (Isolated Mode - Default)

**User:** "Start working on the first task"

```
Starting task session in isolated mode...

Task: Add OAuth2 authentication with Google provider
Branch: issue-5/task-1-add-oauth
Worktree: ~/.track/project-abc/worktrees/issue-5-task-1

Acceptance Criteria:
- [ ] OAuth callback processes Google auth correctly
- [ ] Access tokens securely stored
- [ ] Unit tests achieve 80%+ coverage

Task is now IN_PROGRESS. Ready to begin?
```

### Starting in Branch/Main Mode

**Branch mode** (user says "branch mode", "no worktree"):

```
Task: Add session management
Branch: issue-5/task-2-add-session (checked out in main repo)
```

**Main mode** (user says "on main", "skip PR"):

```
Task: Update logging configuration
Working directly on main. No PR will be created.
```

### Creating PR → Submit for Review

**User:** "Create a PR"

```
Summary: Added OAuth flow, callback handler, token storage, tests (92% coverage)

Acceptance Criteria: ✓ All met

Validation: pnpm typecheck PASSED, pnpm test PASSED
Rebased on main: No conflicts

PR #42 created: https://github.com/owner/repo/pull/42
Task still IN_PROGRESS (lets GitHub automation set column first).

Submit for review now?
```

**User:** "yes" → Task transitions to PR_REVIEW

### Completing a Task

**After PR merged:**

```
PR #42: MERGED

complete_task({
  taskId: "...",
  sessionId: "...",
  finalLogEntry: "Implemented OAuth2 authentication with Google provider. Added callback handler, token storage, and session management. Unit tests achieve 92% coverage."
})

Cleaning up worktree and branch...
Task COMPLETED. Next task available: "Add session management"
```

**Main mode:** Summarize → confirm → commit → `complete_task` with `finalLogEntry` → COMPLETED

### Abandoning / Pausing

**Abandon:** Confirm reason → worktree/branch deleted → ABANDONED
**Pause:** `pause_issue` moves READY tasks to BACKLOG. Resume by starting any task.

## Error Handling

### MCP Server Connection Issues (CRITICAL)

**When MCP tools return unexpected "not found" errors for data that should exist:**

If you were working on an issue/task and suddenly get "Issue not found" or "Task not found" errors, the MCP server is likely connected to the wrong database.

**STOP IMMEDIATELY. Do NOT try to work around the issue.**

Any manual workaround (direct database updates, `gh` CLI, etc.) creates **corrupt, inconsistent state** that will cause more problems later. The MCP tools maintain consistency between the database, git, and GitHub - bypassing them breaks that guarantee.

**What to do:**

1. Stop all work immediately
2. Tell the user: "The MCP server appears to be connected to the wrong database. Please restart your Claude session to reconnect, then we can resume where we left off."
3. **Do not continue** until the user has restarted and confirmed

**Resuming after restart:**

- If a task was IN_PROGRESS, call `load_task_session` with the task ID - it's idempotent and will resume the session
- Call `get_task_execution_log` to read progress from previous sessions - this shows what was already done
- Summarize the previous progress to the user before continuing work
- The worktree and branch will still exist; work can continue from where it stopped
- Check `git status` in the worktree to see what changes were in progress

---

### Session Continuation Recovery (IMPORTANT)

**Task UUIDs from summarized sessions may be hallucinated.** If you get `Task not found`:

1. Use **issue/task numbers from context** (simple integers, reliable)
2. Call `get_task(issueNumber: N, taskNumber: M)` → returns real task ID

**Never** use task UUIDs from summaries - always fetch by issue/task number.

---

### Other Errors

| Error                            | Action                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| Task not found                   | Call `list_available_tasks` to show available              |
| Task in progress (other session) | Wait, or force mode if session stale                       |
| No tasks available               | Check plan or create new tasks                             |
| Create PR failed - no branch     | Main mode; complete directly instead                       |
| Create PR failed - wrong status  | Force mode if state drifted                                |
| Submit failed - no PR            | Call `create_pr` first; force mode if PR exists externally |
| Submit failed - wrong status     | Force mode if state drifted                                |
| Complete failed - PR not merged  | Ask user to merge PR first                                 |
| Complete failed - wrong status   | Force mode if PR actually merged                           |
| Complete failed - PR not found   | Abandon and re-start task                                  |
| Close issue failed - tasks open  | Force mode if work actually done                           |

## Force Mode: Recovering from State Drift

Sometimes the tracked state diverges from reality. This can happen when:

- MCP tools were unavailable during a workflow
- A PR was merged outside the normal flow
- A session timed out but the task is still marked as owned
- Manual intervention changed state without updating the tracker

**Force mode** allows bypassing state machine validation when the user confirms the action is valid.

### Tools with Force Option

| Tool                   | What force bypasses                                      |
| ---------------------- | -------------------------------------------------------- |
| `create_pr`            | IN_PROGRESS status check                                 |
| `submit_for_review`    | IN_PROGRESS status check and PR existence check          |
| `complete_task`        | Status check (allows completing from wrong status)       |
| `abandon_task_session` | Session ownership check (allows abandoning orphan tasks) |
| `close_issue`          | Task completion check (allows closing with open tasks)   |

### When to Offer Force Mode

Offer force mode when you detect a state machine error that suggests drift:

1. **Detect the error**: Tool returns an error about wrong status or ownership
2. **Analyze the situation**: Check what the actual state is vs. expected
3. **Explain to user**: Show the mismatch clearly
4. **Ask for confirmation**: Get explicit approval before using force
5. **Retry with force=true**: Only after user confirms

### Force Mode Protocol

**NEVER use force mode without explicit user confirmation.** Follow this protocol:

```
1. Tool call fails with state machine error
2. Analyze the error message to understand the mismatch
3. Present the situation to the user:
   "The task is in [ACTUAL_STATUS] but the tool expects [EXPECTED_STATUS].
    This can happen when [explanation of how drift occurs].
    Would you like me to force through this operation?"
4. Wait for explicit "yes" or confirmation
5. Retry with force=true
```

### Force Mode Example

```
User: "complete the task"

Error: Task must be in PR_REVIEW status to complete. Current status: IN_PROGRESS.

[Check GitHub: PR #42 is actually merged]

"The task shows IN_PROGRESS but the PR is merged. This happens when PR was
merged outside normal flow. Force-complete the task?"

User: "yes" → complete_task with force=true → Task COMPLETED
```

Same pattern for other force scenarios (abandon orphaned task, close issue with drifted tasks).

## Notes

- **ONE TASK AT A TIME**: Complete a task fully (to COMPLETED or ABANDONED) before starting another. If user requests a new task while one is active, prompt them to finish or abandon the current task first.
- Session timeout is 1 hour of inactivity
- Abandoned tasks can inform re-planning
- Always show acceptance criteria when starting a task
- **ALWAYS use isolated mode** - never autonomously choose branch or main mode
- Only use branch/main mode when the user explicitly requests it
- **NEVER use force mode without explicit user confirmation** - always explain the state mismatch first

### Task Tuning

Before execution, tasks can be tuned using `update_task`:

- **contextInstructions**: Add custom instructions (e.g., "use existing auth pattern in src/auth")
- **acceptanceCriteria**: Refine what needs to be verified
- **description**: Clarify implementation details

## Progress Logging for Session Continuity

Log progress during task execution so that if a session ends unexpectedly, the next session can pick up where you left off. This is about **memory**, not audit trails.

### When to Log

Log at **milestones only** - not every step. Key moments:

1. **Starting significant work** - what approach you're taking
2. **Major findings or decisions** - "Found the issue in X", "Decided to use Y approach"
3. **Completing significant chunks** - after implementing a component, fixing a bug, adding tests
4. **Before natural break points** - if you sense the session might end

### Good vs Bad Entries

```typescript
// ✅ Good - meaningful milestone with context
log_task_progress({
  message: "Implemented OAuth callback with token validation. Added unit tests.",
  filesModified: ["src/auth/callback.ts", "src/auth/__tests__/callback.test.ts"],
});

// ❌ Bad - too granular, don't log routine operations
log_task_progress({ message: "Reading src/auth/session.ts" });
log_task_progress({ message: "Running pnpm test" });
```

### How Often to Log

- **Feature tasks**: 2-4 entries typically (start approach, major milestones, completion)
- **Bug tasks**: 3-5 entries (investigation, root cause, fix applied)
- **Simple tasks**: 1-2 entries may be enough

The goal is that if a new session reads the log, it understands what was done and where to continue.

### Bug Investigation Logging

For **BUG** tasks, logging is especially valuable since the investigation journey informs the fix:

1. **Initial hypotheses** - areas examined, what you suspect
2. **Root cause** - the actual cause and why
3. **Fix applied** - changes made with `filesModified`

```typescript
// Bug investigation pattern
log_task_progress({ message: "Examining session handling. Hypothesis: error not propagated." });
log_task_progress({ message: "ROOT CAUSE: SessionMiddleware redirects without error param." });
log_task_progress({ message: "FIX: Added ?error=session_expired to redirect.", filesModified: [...] });
```

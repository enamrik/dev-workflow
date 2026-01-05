---
name: dwf-work-task
description: Manage task execution lifecycle - start, complete, or abandon tasks. Supports 3 execution modes (isolated, branch, main) and PR-based workflow. Auto-invoked when user wants to "start task", "work on task", "complete task", "finish task", "abandon task", "create PR", "submit for review", "merge PR", "pause issue", etc. (project)
allowed-tools: mcp:dev-workflow-tracker:load_task_session, mcp:dev-workflow-tracker:abandon_task_session, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:update_task, mcp:dev-workflow-tracker:create_pr, mcp:dev-workflow-tracker:submit_for_review, mcp:dev-workflow-tracker:complete_task, mcp:dev-workflow-tracker:get_task_pr_status, mcp:dev-workflow-tracker:pause_issue, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:log_task_progress
---

# Work Task Skill

## Critical Constraint: One Task at a Time

**You MUST complete one task fully before starting another.** Never work on multiple tasks in the same session.

A task is only "complete" when it reaches a terminal state:

- **COMPLETED** - Work done, PR merged (or committed on main mode)
- **ABANDONED** - Work stopped, reason documented

If a task is IN_PROGRESS or PR_REVIEW, you must finish that task's lifecycle before starting a new one. If the user asks to work on a different task while one is in progress, remind them:

> "You have an active task in progress: [task title]. Would you like to complete or abandon it first before starting a new task?"

This ensures:

- Clean git state (no mixed changes across tasks)
- Proper worktree management (one worktree per active task)
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

1. **Check for active tasks first:**
   - Before starting ANY new task, verify no task is currently IN_PROGRESS or PR_REVIEW
   - If a task is active → remind user to complete or abandon it first
   - Only proceed if there are no active tasks in the session

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
   - This returns full context: task, issue, plan, labels, worktree info
   - If task is already IN_PROGRESS, it resumes the existing session
   - Review title, description, and acceptance criteria from the response

6. **Present task to user:**
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
   - Check context (CLAUDE.md, task labels, project docs) for required validation
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

When the user needs to push more changes to an existing PR (e.g., addressing review feedback):

1. **Make the requested changes**
2. **Rebase on latest main before pushing:**
   - Run: `git fetch origin main && git rebase origin/main`
   - If conflicts occur:
     - Attempt to resolve them automatically based on context
     - Use `git add <resolved-files>` and `git rebase --continue`
     - If a conflict is ambiguous or risky, ask the user for guidance
   - **Re-run full validation** after rebase (check CLAUDE.md, package.json scripts, or Makefile for commands)
   - If validation fails, fix the issues before pushing
   - **Why:** Keeps the PR up-to-date, prevents merge conflicts, ensures CI passes
3. **Commit and push:**
   - Stage and commit the changes
   - Push to the PR branch: `git push` (or `git push --force-with-lease` after rebase)

### To Complete a Task

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
   - Call `complete_task` with task ID and session ID
   - Task transitions directly to COMPLETED

**For Isolated/Branch Modes (with PR):**

1. **Verify PR is merged:**
   - Check PR status with `get_task_pr_status`
   - If not merged → tell user to merge the PR first
   - If merged → proceed

2. **Complete the task:**
   - Call `complete_task` with task ID and session ID
   - This atomically: verifies PR merged, pulls main, cleans up worktree/branch
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

## Execution Mode Details

### Isolated Mode (Default)

When starting with `mode: "isolated"`:

- A new git branch is created: `issue-{N}/task-{N}-{slug}`
- A worktree directory is created in the global track directory
- Work happens in the isolated worktree, not the main repo
- On submit: branch is pushed, PR created
- On completion: worktree removed, branch deleted (after merge)
- On abandonment: worktree AND branch deleted

**Best for:**

- Feature development that needs review
- Working on multiple tasks in parallel
- Changes that might conflict with other work
- Team workflows requiring code review

**CRITICAL: Always use the worktree path for ALL operations**

When a task is started in isolated mode, `load_task_session` returns a `worktreePath`. You MUST use this path for ALL file operations during the task:

- **Read/Edit/Write tools**: Always use the full worktree path (e.g., `/Users/.../.track/project/worktrees/issue-N-task-N/path/to/file`)
- **Bash commands**: Always `cd` to the worktree path or use absolute paths within the worktree
- **Glob/Grep tools**: Always specify the worktree path in the `path` parameter

**NEVER** fall back to the main repo path. The main repo may be on a different branch or have different content. All changes for the PR must be made in the worktree.

Common mistake to avoid:

```
❌ Read("/Users/user/code/project/Makefile")           # Main repo - WRONG
✅ Read("/Users/user/.track/project/worktrees/issue-1-task-1/Makefile")  # Worktree - CORRECT
```

### Branch Mode

**Only use when the user explicitly requests it** (e.g., "branch mode", "no worktree").

When starting with `mode: "branch"`:

- A new git branch is created: `issue-{N}/task-{N}-{slug}`
- Branch is checked out in the main repository
- No worktree created
- On submit: branch is pushed, PR created
- On completion: branch deleted (after merge), checkout main
- On abandonment: branch deleted, checkout main

**Only use when user explicitly requests it for:**

- Sequential work (one task at a time)
- When user says they don't want a worktree

### Main Mode

**WARNING: Only use when the user explicitly requests it.** Never autonomously choose this mode.

When starting with `mode: "main"`:

- No branch created, work directly on main
- No PR workflow
- On completion: changes committed directly to main
- On abandonment: uncommitted changes may be lost

**Only use when user explicitly requests it for:**

- Emergency hotfixes where user explicitly skips review
- Cases where user says "on main", "main mode", "skip PR", "no branch"

## Example Interactions

### Starting a Task (Isolated Mode - Default)

**User:** "Start working on the first task"

**Response:**

```
Starting task session in isolated mode...

Task: Add OAuth2 authentication with Google provider

Created isolated environment:
- Branch: issue-5/task-1-add-oauth
- Worktree: ~/.track/project-abc/worktrees/issue-5-task-1

Description:
Implement Google OAuth2 authentication flow including callback handling,
token management, and error handling. Includes unit and integration tests.

Acceptance Criteria:
- [ ] OAuth callback processes Google auth response correctly
- [ ] Access tokens are securely stored
- [ ] Refresh tokens trigger automatic renewal
- [ ] Auth failures return appropriate error responses
- [ ] Unit tests achieve 80%+ coverage
- [ ] Integration test covers sign-in flow

Task is now IN_PROGRESS.

Ready to begin implementation. Where would you like to start?
```

### Starting in Branch Mode

**User:** "Start task 2 in branch mode"

**Response:**

```
Starting task session in branch mode...

Task: Add session management and user profile

Created branch: issue-5/task-2-add-session-management
(checked out in main repository)

Acceptance Criteria:
- [ ] Session persists across page refreshes
- [ ] User profile displays name and email
- [ ] Logout clears session properly

Task is now IN_PROGRESS.

Ready to begin implementation. Where would you like to start?
```

### Starting in Main Mode

**User:** "Start the config update task on main"

**Response:**

```
Starting task session in main mode...

Task: Update logging configuration

Working directly on main branch. No PR will be created - changes
will be committed directly when you complete the task.

Acceptance Criteria:
- [ ] Log level configurable via environment variable
- [ ] Log format matches production standards

Task is now IN_PROGRESS.

Ready to make the changes?
```

### Creating a PR and Submitting for Review

**User:** "I've finished the implementation, create a PR"

**Response:**

```
Here's a summary of what was completed:

**Task:** Add OAuth2 authentication with Google provider

**Changes made:**
- Created `src/auth/google-oauth.ts` with OAuth flow
- Added callback handler in `src/routes/auth.ts`
- Implemented token storage in `src/services/token-store.ts`
- Added unit tests (92% coverage)
- Added integration test for sign-in flow

**Acceptance Criteria:**
- [x] OAuth callback processes Google auth response correctly
- [x] Access tokens are securely stored
- [x] Refresh tokens trigger automatic renewal
- [x] Auth failures return appropriate error responses
- [x] Unit tests achieve 80%+ coverage
- [x] Integration test covers sign-in flow

Running validation...
  - pnpm typecheck: PASSED
  - pnpm test: PASSED

Committing changes...
  [issue-5/task-1-add-oauth abc1234] Add OAuth2 authentication with Google

Rebasing on latest main...
  - git fetch origin main
  - git rebase origin/main
  - No conflicts, rebase successful

Creating PR...

[Calling create_pr...]

PR created successfully:
- PR #42: https://github.com/owner/repo/pull/42
- Title: [#5] Add OAuth2 authentication with Google provider
- Status: OPEN

Task status is still IN_PROGRESS. This is intentional to let GitHub's
automation set the project column to "In progress" first.

Would you like to submit it for review now? This will transition the
task to PR_REVIEW and set the project column to "In review".
```

**User:** "yes, submit for review"

**Response:**

```
Submitting for review...

[Calling submit_for_review...]

Task transitioned to PR_REVIEW. The GitHub project column is now set to
"In review".

PR #42 is ready for review: https://github.com/owner/repo/pull/42
You can still push additional changes to the branch if needed.
```

### Completing After PR Merged

**User:** "The PR is merged, complete the task"

**Response:**

```
Checking PR status...
  PR #42: MERGED

Completing task...
  - Pulling latest changes to main
  - Cleaning up worktree: ~/.track/project-abc/worktrees/issue-5-task-1
  - Deleting branch: issue-5/task-1-add-oauth

Task "Add OAuth2 authentication with Google provider" is now COMPLETED.

Next available task: "Add session management and user profile"
Would you like to start working on it?
```

### Completing in Main Mode

**User:** "I've finished, mark it complete"

**Response:**

```
Here's a summary of what was completed:

**Task:** Update logging configuration

**Changes made:**
- Updated `src/config/logging.ts` with environment variable support
- Updated log format to match production standards

**Acceptance Criteria:**
- [x] Log level configurable via environment variable
- [x] Log format matches production standards

Running validation...
  - pnpm typecheck: PASSED
  - pnpm test: PASSED

Should I mark this task as complete?
```

**User:** "yes"

**Response:**

```
Creating git commit...
  [main def5678] Update logging configuration (#8)

Completing task session...

Task "Update logging configuration" is now COMPLETED.

Next available task: "Add request tracing"
Would you like to start working on it?
```

### Checking PR Status

**User:** "What's the PR status?"

**Response:**

```
PR status for task "Add OAuth2 authentication":

- PR #42: https://github.com/owner/repo/pull/42
- Status: OPEN
- Mergeable: Yes
- Branch: issue-5/task-1-add-oauth

The PR is open and ready to be merged. Once merged, say "complete the task"
to finish up and clean the worktree.
```

### Abandoning a Task

**User:** "I need to abandon this task, the approach won't work"

**Response:**

```
Are you sure you want to abandon this task?
Reason provided: "the approach won't work"

This will:
- Mark the task as ABANDONED
- Delete the worktree: ~/.track/project-abc/worktrees/issue-5-task-1
- Delete the branch: issue-5/task-1-add-oauth

Proceeding with abandonment...

Task "Add OAuth2 authentication with Google provider" is now ABANDONED.

Would you like to re-plan issue #5 with a different approach?
```

### Pausing an Issue

**User:** "I need to pause issue #5, something urgent came up"

**Response:**

```
Pausing issue #5...

Moved 3 tasks from READY to BACKLOG:
- Task 2: Add session management
- Task 3: Implement user profile
- Task 4: Add logout functionality

Issue #5 is now paused. When you're ready to resume, just start
any task and the remaining BACKLOG tasks will transition back to READY.
```

## Error Handling

**Task not found:**

- Explain the error
- Call `list_available_tasks` to show what's available

**Task already in progress (by another session):**

- Explain another session owns the task
- Suggest waiting or checking if session timed out
- If session appears stale → offer to use force mode (see Force Mode section)

**No tasks available:**

- Explain all tasks are completed or in progress
- Suggest checking the plan or creating new tasks

**Create PR failed - no branch:**

- Task was started in main mode
- Explain that main mode doesn't support PR workflow
- Complete the task directly instead

**Create PR failed - wrong status:**

- Task is not IN_PROGRESS (e.g., already in PR_REVIEW or COMPLETED)
- If the task state has drifted → offer to use force mode

**Submit for review failed - no PR:**

- Task doesn't have a PR yet
- Explain that `create_pr` must be called first
- If a PR was created outside the tool → offer to use force mode

**Submit for review failed - wrong status:**

- Task is not IN_PROGRESS (e.g., already in PR_REVIEW or COMPLETED)
- If the task state has drifted → offer to use force mode

**Complete failed - PR not merged:**

- For isolated/branch modes, PR must be merged first
- Show current PR status
- Ask user to merge the PR on GitHub first

**Complete failed - wrong status:**

- Task is not in expected status (e.g., IN_PROGRESS instead of PR_REVIEW)
- If the PR is actually merged but task status is wrong → offer force mode

**Complete failed - PR not found:**

- Task is in PR_REVIEW but PR was deleted
- Suggest abandoning and re-starting the task

**Close issue failed - tasks not complete:**

- Some tasks are not in terminal state (COMPLETED or ABANDONED)
- If the work is actually done but not tracked → offer force mode

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

### Force Mode Examples

**Example 1: Completing a task when PR was merged externally**

```
User: "complete the task"

[Calling complete_task...]

Error: Task must be in PR_REVIEW status to complete. Current status: IN_PROGRESS.
Use submit_for_review first to create a PR, or use force=true to bypass this check.

[Checking... The PR is actually merged on GitHub]

I see that the task is still marked as IN_PROGRESS, but the PR has been merged.
This can happen if the PR was merged outside the normal workflow.

Would you like me to force-complete the task? This will bypass the status check
and mark the task as COMPLETED.
```

**User:** "yes, force it"

**Response:**

```
[Calling complete_task with force=true...]

Task force-completed. PR #42 status: merged. Worktree cleaned up.

Task "Add OAuth2 authentication" is now COMPLETED.
```

**Example 2: Abandoning an orphaned task**

```
User: "abandon the stuck task"

[Calling abandon_task_session...]

Error: Task is not associated with session abc123. Current session: xyz789.
Use force=true to bypass this check if the session has drifted.

[Analyzing...]

The task appears to be locked by a stale session (xyz789) that is no longer active.
This can happen when a session times out or disconnects unexpectedly.

Would you like me to force-abandon the task? This will bypass the session
ownership check and mark the task as ABANDONED.
```

**User:** "yes"

**Response:**

```
[Calling abandon_task_session with force=true...]

Task force-abandoned. Worktree and branch cleaned up.

Task "Implement auth flow" is now ABANDONED.
```

**Example 3: Closing an issue when tasks drifted**

```
User: "close issue #5"

[Calling close_issue...]

Error: Cannot close issue #5. The following tasks are not complete:
  - Task 2: Add tests (IN_PROGRESS)
Use force=true to close anyway if the work is actually done.

[Checking task 2...]

Task 2 shows as IN_PROGRESS, but checking the actual git state...
The tests were added and the PR was merged. The task status was not
updated due to a tool failure during completion.

Would you like me to force-close the issue? This will bypass the
task completion check. The incomplete task will remain in its current state.
```

**User:** "yes, force close it"

**Response:**

```
[Calling close_issue with force=true...]

Issue #5 force-closed.
Note: Task 2 is still marked as IN_PROGRESS.

Issue "User Authentication" is now CLOSED.
```

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

## Bug Investigation Workflow

When working on a **BUG** type issue, the task follows an investigation-first approach. Use `log_task_progress` to document your findings throughout the investigation.

### Why Log During Bug Investigation?

- **Creates an audit trail**: Documents what was investigated and why
- **Captures the journey**: Root cause discovery is not always linear
- **Helps future debugging**: Similar bugs can reference the investigation log
- **Informs the PR**: Findings can be summarized in the PR description

### When to Log Progress

Call `log_task_progress` at these key moments:

1. **Initial investigation findings**
   - What areas of code you are examining
   - Initial hypotheses about the cause

2. **Root cause identified**
   - The actual cause of the bug
   - Why it was happening
   - Any related issues discovered

3. **Fix applied**
   - What changes were made
   - Files modified
   - Why this fix addresses the root cause

### Bug Investigation Example

**User:** "Start the bug task"

**Response:**

```
Starting task session in isolated mode...

Task: Investigate and fix: Login fails silently when session expires

This is a BUG investigation task. I will document findings using progress logs
as I investigate.

Symptoms (from issue):
- Users stuck on login page with no error message
- Happens when session has expired

Reproduction steps:
1. Log in successfully
2. Wait for session to expire
3. Attempt authenticated action
4. Observe: redirected to login with no message

Let me start investigating...
```

**During investigation:**

```
[Logging progress: "Examining session handling in src/auth/session.ts.
The sessionExpired check returns early without setting an error message.
Hypothesis: error state not propagated to UI."]

Found it. The issue is in the session middleware - when a session expires,
it redirects without passing an error code to the login page.

[Logging progress: "ROOT CAUSE: SessionMiddleware.validateSession() at
line 45 calls res.redirect(\"/login\") without query param. Login page
checks for ?error=session_expired to show message, but it is never set."]

I will fix this by adding the error parameter to the redirect.

[Logging progress: "FIX: Modified SessionMiddleware.validateSession() to
redirect to /login?error=session_expired. Added test for expired session
redirect. Files: src/middleware/session.ts, tests/session.test.ts"]
```

**On completion:**

```
Bug investigation complete. Here is the summary:

**Root Cause:**
SessionMiddleware.validateSession() was redirecting to /login without
the error query parameter that the login page needs to display the
"Session expired" message.

**Fix Applied:**
- Modified redirect to include ?error=session_expired
- Added unit test for expired session redirect behavior

**Files Modified:**
- src/middleware/session.ts
- tests/session.test.ts

Ready to submit for review?
```

### Progress Log API

```typescript
log_task_progress({
  taskId: "...",
  sessionId: "...",
  message: "ROOT CAUSE: Description of what was found",
  filesModified: ["src/file1.ts", "src/file2.ts"], // optional
});
```

The `filesModified` parameter is optional but recommended when logging the fix.

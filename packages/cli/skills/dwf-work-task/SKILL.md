---
name: dwf-work-task
description: Manage task execution lifecycle - start, complete, or abandon tasks. Supports 3 execution modes (isolated, branch, main) and PR-based workflow. Auto-invoked when user wants to "start task", "work on task", "complete task", "finish task", "abandon task", "submit for review", "merge PR", etc.
allowed-tools: mcp:dev-workflow-tracker:get_task_for_session, mcp:dev-workflow-tracker:start_task_session, mcp:dev-workflow-tracker:abandon_task_session, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:update_task, mcp:dev-workflow-tracker:submit_for_review, mcp:dev-workflow-tracker:complete_task, mcp:dev-workflow-tracker:get_task_pr_status
---

# Work Task Skill

## When to Invoke

**Starting work:**
- User mentions: "start task", "work on task", "begin task", "pick up task"
- User wants to work: "let's work on the first task", "start working on #1"
- User is ready: "I'm ready to implement", "let's begin"

**Submitting for review:**
- User mentions: "submit for review", "create PR", "open PR", "ready for review"
- User finished implementation: "I've finished, create a PR"

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

## Task Lifecycle

The task lifecycle supports 3 execution modes with a PR-based review flow:

```
                    PENDING
                       │
         ┌─────────────┼─────────────┐
         │             │             │
     isolated        branch         main
     (default)                       │
         │             │             │
         ▼             ▼             ▼
    IN_PROGRESS   IN_PROGRESS   IN_PROGRESS
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

| From | To | Trigger |
|------|-----|---------|
| PENDING | IN_PROGRESS | `start_task_session` |
| IN_PROGRESS | PR_REVIEW | `submit_for_review` (isolated/branch modes) |
| IN_PROGRESS | COMPLETED | `complete_task` (main mode only) |
| PR_REVIEW | COMPLETED | `complete_task` (after PR merged) |
| Any | ABANDONED | `abandon_task_session` |

## Process

### To Start a Task

1. **Identify the task:**
   - If user specified a task → use that task ID
   - If not specified → call `list_available_tasks` and help user choose
   - If only one task available → confirm and start it

2. **Get task details:**
   - Call `get_task_for_session` with the task ID
   - Review title, description, and acceptance criteria

3. **Determine execution mode:**
   - **ALWAYS use `isolated` mode** unless the user explicitly requests otherwise
   - Only use `branch` if user explicitly says "branch mode", "no worktree", etc.
   - Only use `main` if user explicitly says "on main", "main mode", "skip PR", etc.
   - **NEVER autonomously choose a non-default mode** based on task complexity or size

4. **Start the session:**
   - Call `start_task_session` with task ID, session ID, and mode
   - If successful → show task details and begin work

5. **Present task to user:**
   - Show what needs to be implemented
   - Show acceptance criteria as a checklist
   - For isolated mode: show worktree path and branch name
   - For branch mode: show branch name
   - For main mode: note that PR will be skipped
   - Offer to begin implementation

### To Submit for Review (Isolated/Branch Modes)

After implementing the task, submit for PR review:

1. **Summarize work done:**
   - List the key changes made (files modified, features added)
   - Review acceptance criteria against what was implemented
   - Show which criteria are met

2. **Run validation steps:**
   - Check context (CLAUDE.md, task labels, project docs) for required validation
   - Run any tests, linting, build, or other quality checks mentioned
   - Common validations: `make test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
   - If validation fails → fix issues before submitting

3. **Create git commit:**
   - Stage all changes related to the task
   - Create a commit with a clear message describing the work done
   - Include task context in commit message (e.g., "Implement X for issue #N")

4. **Submit for review:**
   - Call `submit_for_review` with task ID
   - This atomically: pushes branch, creates PR, transitions to PR_REVIEW
   - Show the PR URL to user

5. **Report status:**
   - Task is now in PR_REVIEW
   - PR is open and ready for review
   - User can still push changes to the PR branch

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

### Submitting for Review

**User:** "I've finished the implementation, submit for review"

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

Creating git commit...
  [issue-5/task-1-add-oauth abc1234] Add OAuth2 authentication with Google

Submitting for review...

PR created successfully:
- PR #42: https://github.com/owner/repo/pull/42
- Title: [#5] Add OAuth2 authentication with Google provider
- Status: OPEN

Task is now in PR_REVIEW status. The PR is ready for review.
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

## Error Handling

**Task not found:**
- Explain the error
- Call `list_available_tasks` to show what's available

**Task already in progress (by another session):**
- Explain another session owns the task
- Suggest waiting or checking if session timed out

**No tasks available:**
- Explain all tasks are completed or in progress
- Suggest checking the plan or creating new tasks

**Submit for review failed - no branch:**
- Task was started in main mode
- Explain that main mode doesn't support PR workflow
- Complete the task directly instead

**Submit for review failed - GitHub not configured:**
- GitHub integration not enabled
- Guide user to run `update_settings` with `enable_github` action

**Complete failed - PR not merged:**
- For isolated/branch modes, PR must be merged first
- Show current PR status
- Ask user to merge the PR on GitHub first

**Complete failed - PR not found:**
- Task is in PR_REVIEW but PR was deleted
- Suggest abandoning and re-starting the task

## Notes

- Only ONE task should be in progress at a time per session
- Session timeout is 1 hour of inactivity
- Abandoned tasks can inform re-planning
- Always show acceptance criteria when starting a task
- **ALWAYS use isolated mode** - never autonomously choose branch or main mode
- Only use branch/main mode when the user explicitly requests it

### Task Tuning

Before execution, tasks can be tuned using `update_task`:
- **contextInstructions**: Add custom instructions (e.g., "use existing auth pattern in src/auth")
- **acceptanceCriteria**: Refine what needs to be verified
- **description**: Clarify implementation details

---
name: dwf-work-task
description: Manage task execution lifecycle - start, complete, or abandon tasks. Supports PR workflow for code review. Auto-invoked when user wants to "start task", "work on task", "complete task", "finish task", "abandon task", "create PR", "merge PR", etc.
allowed-tools: mcp:dev-workflow-tracker:get_task_for_session, mcp:dev-workflow-tracker:start_task_session, mcp:dev-workflow-tracker:complete_task_session, mcp:dev-workflow-tracker:abandon_task_session, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:update_task, mcp:dev-workflow-tracker:create_task_pr, mcp:dev-workflow-tracker:merge_task_pr, mcp:dev-workflow-tracker:get_task_pr_status
---

# Work Task Skill

## When to Invoke

**Starting work:**
- User mentions: "start task", "work on task", "begin task", "pick up task"
- User wants to work: "let's work on the first task", "start working on #1"
- User is ready: "I'm ready to implement", "let's begin"

**Completing work:**
- User mentions: "complete task", "finish task", "done with task", "mark complete"
- User finished: "I've finished the implementation", "tests are passing"

**Abandoning work:**
- User mentions: "abandon task", "stop task", "cancel task"
- User blocked: "I can't continue", "this approach won't work"

**Listing available work:**
- User asks: "what tasks are available?", "what can I work on?"
- User browses: "show me the tasks", "list pending tasks"

**PR workflow:**
- User mentions: "create PR", "open PR", "make a pull request"
- User wants review: "submit for review", "ready for review"
- User merging: "merge PR", "merge the pull request"
- User checking: "PR status", "check PR"

## Task Lifecycle

```
PENDING → IN_PROGRESS → COMPLETED
              ↓
          ABANDONED
```

### Starting a Task

When starting a task:
1. Task status changes to IN_PROGRESS
2. Session is associated with the task
3. Optionally, a git worktree is created for isolated execution

### Completing a Task

When completing a task:
1. Task status changes to COMPLETED
2. Session is cleared
3. Worktree is cleaned up (branch is kept for PR creation)

### Abandoning a Task

When abandoning a task:
1. Task status changes to ABANDONED
2. Session is cleared
3. Worktree and branch are deleted (abandoned work)
4. Reason is recorded

## Process

### To Start a Task

1. **Identify the task:**
   - If user specified a task → use that task ID
   - If not specified → call `list_available_tasks` and help user choose
   - If only one task available → confirm and start it

2. **Get task details:**
   - Call `get_task_for_session` with the task ID
   - Review title, description, and acceptance criteria

3. **Check for worktree request:**
   - If user mentions "worktree", "isolated", "separate branch" → set `createWorktree: true`
   - Otherwise, work in the main repository

4. **Start the session:**
   - Call `start_task_session` with task ID, session ID, and optional `createWorktree`
   - If successful → show task details and begin work

5. **Present task to user:**
   - Show what needs to be implemented
   - Show acceptance criteria as a checklist
   - If worktree was created, show the worktree path and branch name
   - Offer to begin implementation

### To Complete a Task

**IMPORTANT: Always ask user for confirmation before completing a task.**

1. **Summarize work done:**
   - List the key changes made (files modified, features added)
   - Review acceptance criteria against what was implemented
   - Show which criteria are met

2. **Ask for confirmation:**
   - Present summary to user
   - Ask: "Should I mark this task as complete?"
   - Wait for explicit user approval before proceeding
   - Do NOT call `complete_task_session` without user saying yes

3. **Re-ask after addressing concerns:**
   - If user reports an issue or gives feedback, fix it first
   - After fixing, **always re-summarize and ask again** if task should be marked complete
   - Do NOT wait silently after addressing concerns — proactively re-ask
   - Continue this cycle until user explicitly approves completion

4. **Run validation steps:**
   - Check context (CLAUDE.md, task labels, project docs) for required validation
   - Run any tests, linting, build, or other quality checks mentioned
   - Common validations: `make test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
   - If validation fails → fix issues and re-ask (go back to step 3)

5. **Create git commit:**
   - Stage all changes related to the task
   - Create a commit with a clear message describing the work done
   - Include task context in commit message (e.g., "Implement X for issue #N")
   - This ensures all task work is properly committed before completion

6. **Complete the session (only after user confirms and validation passes):**
   - Call `complete_task_session` with task ID and session ID
   - Worktree will be cleaned up automatically (branch preserved)

7. **Report completion:**
   - Show task is now COMPLETED
   - Suggest next steps (next task, or done with issue)

### To Abandon a Task

1. **Confirm abandonment:**
   - Ask user for the reason
   - Confirm they want to abandon (work will be lost)

2. **Abandon the session:**
   - Call `abandon_task_session` with task ID, session ID, and reason
   - Worktree and branch will be deleted

3. **Report and suggest:**
   - Show task is now ABANDONED
   - Suggest alternatives (different approach, re-plan issue)

## Git Worktree Support

When starting a task with `createWorktree: true`:
- A new git branch is created: `issue-{N}/task-{N}-{slug}`
- A worktree directory is created: `.worktrees/issue-{N}-task-{N}`
- Work happens in the isolated worktree, not the main repo
- On completion: worktree removed, branch preserved (for PR)
- On abandonment: worktree AND branch deleted

**When to use worktrees:**
- User explicitly asks for isolated execution
- User mentions "worktree", "separate branch", or "isolated"
- Working on changes that might conflict with other work

## GitHub PR Workflow

Tasks that use worktrees can create PRs for code review before merging to main.

### PR Lifecycle

```
Task IN_PROGRESS → Create PR (DRAFT/OPEN) → Review → Merge PR → Task COMPLETED
```

### Creating a PR

After implementing a task with a worktree:
1. **Call `create_task_pr`** with the task ID
   - PR title defaults to `[#issueNumber] taskTitle`
   - PR body includes task description
   - If issue is synced to GitHub, "Closes #N" is auto-added to link them
   - Use `draft: true` for work-in-progress PRs
2. **PR info is stored** on the task (prUrl, prNumber, prStatus)

**Requirements:**
- Task must have a branch (started with `createWorktree: true`)
- GitHub integration must be enabled via `update_settings`

### Merging a PR

After PR is reviewed and approved:
1. **Call `merge_task_pr`** with the task ID
   - Default strategy is `squash` (cleaner history)
   - Can use `merge` or `rebase` if preferred
2. **PR status updates** to MERGED on the task

### Checking PR Status

To check current PR status:
1. **Call `get_task_pr_status`** with the task ID
2. Returns fresh status from GitHub (DRAFT, OPEN, MERGED, CLOSED)
3. Cached status is updated automatically

### When to Create PRs

**Always create PRs when:**
- Task was started with a worktree
- User mentions "PR", "pull request", "code review"
- Team workflow requires PR reviews

**Skip PRs when:**
- Working directly on main branch (no worktree)
- Small fixes that don't need review
- User explicitly says to skip PR

## Example Interactions

### Starting a Task

**User:** "Start working on the first task"

**Response:**
```
Starting task session...

Task: Add OAuth2 authentication with Google provider

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

### Starting with Worktree

**User:** "Start task 2 in a worktree"

**Response:**
```
Starting task session with isolated worktree...

Task: Add session management and user profile

Created worktree:
- Branch: issue-5/task-2-add-session-management
- Path: .worktrees/issue-5-task-2

You're now working in an isolated environment. Changes won't affect
the main branch until you create a PR.

Acceptance Criteria:
- [ ] Session persists across page refreshes
- [ ] User profile displays name and email
- [ ] Logout clears session properly

Task is now IN_PROGRESS.

Ready to begin implementation. Where would you like to start?
```

### Completing a Task

**User:** "I've finished the task, tests are passing"

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

Should I mark this task as complete?
```

**User:** "yes"

**Response:**
```
Running validation steps from project context...
  - pnpm typecheck: PASSED
  - pnpm test: PASSED

Creating git commit...
  [main abc1234] Add OAuth2 authentication with Google provider (#5)
   6 files changed, 342 insertions(+)

Completing task session...

Task "Add OAuth2 authentication with Google provider" is now COMPLETED.

Next available task: "Add session management and user profile"
Would you like to start working on it?
```

### Completing After Fixing Issues (Re-ask Flow)

**User:** "I think I'm done"

**Response:**
```
Here's a summary of what was completed:

**Task:** Add form validation for user registration

**Changes made:**
- Added validation rules in `src/validators/user.ts`
- Added error display component in `src/components/FormError.tsx`
- Added unit tests

**Acceptance Criteria:**
- [x] Email format validation
- [x] Password strength requirements
- [x] Error messages display inline
- [ ] Form disables submit while validating

Should I mark this task as complete?
```

**User:** "Actually the submit button doesn't disable, can you fix that?"

**Response:**
```
Good catch! Let me fix that.

[Makes changes to disable submit button during validation]

Done! I've updated `src/components/RegisterForm.tsx` to disable the
submit button while validation is in progress.

Here's the updated summary:

**Changes made:**
- Added validation rules in `src/validators/user.ts`
- Added error display component in `src/components/FormError.tsx`
- Updated `RegisterForm.tsx` to disable submit during validation
- Added unit tests

**Acceptance Criteria:**
- [x] Email format validation
- [x] Password strength requirements
- [x] Error messages display inline
- [x] Form disables submit while validating

All criteria now met. Should I mark this task as complete?
```

**User:** "yes looks good"

**Response:**
```
Running validation steps from project context...
  - pnpm typecheck: PASSED
  - pnpm test: PASSED

Creating git commit...
  [main abc1234] Add form validation for user registration (#12)
   4 files changed, 156 insertions(+)

Completing task session...

Task "Add form validation for user registration" is now COMPLETED.

Next available task: "Add password reset flow"
Would you like to start working on it?
```

### Abandoning a Task

**User:** "I need to abandon this task, the approach won't work"

**Response:**
```
Are you sure you want to abandon this task?
Reason provided: "the approach won't work"

This will mark the task as ABANDONED. You can re-plan the issue
with a different approach if needed.

Proceeding with abandonment...

Task "Add OAuth2 authentication with Google provider" is now ABANDONED.

Would you like to re-plan issue #5 with a different approach?
```

### Creating a PR After Task Completion

**User:** "Create a PR for the task"

**Response:**
```
Creating PR for task "Add OAuth2 authentication"...

PR created successfully:
- PR #42: https://github.com/owner/repo/pull/42
- Title: [#5] Add OAuth2 authentication with Google provider
- Status: OPEN
- Linked to GitHub issue #5 (will auto-close on merge)

The PR is ready for review. Once approved, say "merge the PR" to merge it.
```

### Creating a Draft PR

**User:** "Create a draft PR, it's not ready for review yet"

**Response:**
```
Creating draft PR for task "Add session management"...

Draft PR created successfully:
- PR #43: https://github.com/owner/repo/pull/43
- Title: [#5] Add session management and user profile
- Status: DRAFT

The PR is marked as draft. When ready for review, you can convert it
to ready on GitHub, or create a new PR.
```

### Merging a PR

**User:** "Merge the PR"

**Response:**
```
Merging PR #42 for task "Add OAuth2 authentication"...

PR merged successfully using squash strategy.
- PR #42 is now MERGED
- GitHub issue #5 has been auto-closed

Task "Add OAuth2 authentication with Google provider" is now COMPLETED.

Next available task: "Add session management and user profile"
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

The PR is open and ready to be merged. Say "merge the PR" when ready.
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

**PR creation failed - no branch:**
- Task doesn't have a branch (wasn't started with worktree)
- Suggest starting a new task with `createWorktree: true`
- Or create a branch manually and use `gh pr create`

**PR creation failed - GitHub not configured:**
- GitHub integration not enabled
- Guide user to run `update_settings` with `enable_github` action

**PR already exists:**
- Task already has a PR associated
- Show existing PR URL and status
- Suggest using `get_task_pr_status` to check it

**PR merge failed - not mergeable:**
- PR has conflicts or failing checks
- Suggest resolving conflicts on GitHub
- Check PR status for details

## Notes

- Only ONE task should be in progress at a time per session
- Session timeout is 1 hour of inactivity
- Abandoned tasks can inform re-planning
- Always show acceptance criteria when starting a task

### Task Tuning

Before execution, tasks can be tuned using `update_task`:
- **contextInstructions**: Add custom instructions (e.g., "use existing auth pattern in src/auth")
- **acceptanceCriteria**: Refine what needs to be verified
- **description**: Clarify implementation details

---
name: dfl-worker-task
description: Execute tasks - load, implement, create PR, and complete. Used by workers and for inline execution. Does NOT dispatch to workers. Auto-invoked for task execution after dispatch decision is made.
allowed-tools: mcp:dev-workflow-tracker:load_task_session, mcp:dev-workflow-tracker:abandon_task, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan, mcp:dev-workflow-tracker:update_task, mcp:dev-workflow-tracker:create_pr, mcp:dev-workflow-tracker:submit_for_review, mcp:dev-workflow-tracker:complete_task, mcp:dev-workflow-tracker:get_task_pr_status, mcp:dev-workflow-tracker:pause_issue, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:log_task_progress, mcp:dev-workflow-tracker:get_task_execution_log, mcp:dev-workflow-tracker:end_worker_session
---

# Worker Task Skill

This skill handles task execution - loading tasks, implementing them, creating PRs, and completing them.

## Your Mission (Workers Only)

**If you are running as a worker process**, your mission is simple:

> **Execute this task and call `end_worker_session()`. That is your terminal action.**
> Everything you do is in service of reaching that call.

The worker process that spawned you is waiting for `end_worker_session()` to signal completion. Until you call it, the worker cannot terminate cleanly.

> ⚠️ **CRITICAL: `end_worker_session()` is your FINAL action.**
>
> - The worker process terminates immediately after this call
> - NEVER output text, call tools, or do anything after it
> - Think of it as `process.exit()` - there is no "after"

**IMPORTANT:** This skill does NOT dispatch tasks to workers. It is used:

- By workers to execute tasks they claimed from the queue
- By `dfl-work-task` for inline execution when no workers are available

## Critical Constraint: One Task at a Time Per Session

**Within a single Claude session, complete one task fully before starting another.**

This constraint is **per-session**, not system-wide. Multiple Claude sessions CAN work on different tasks in parallel - that's the whole point of isolated worktrees! The constraint only means:

- **This session** should not juggle multiple tasks simultaneously
- If **you** started a task earlier in this conversation, finish it before starting another
- Tasks owned by **other sessions** are irrelevant to this check

A task is only "complete" when it reaches a terminal state:

- **COMPLETED** - Work done, PR merged
- **ABANDONED** - Work stopped, reason documented

**How to check:** If you started a task earlier in this conversation (you called `load_task_session`), check if that task is still IN_PROGRESS or PR_REVIEW before starting a new one. If you haven't started any task in this conversation, you're free to start one - even if other tasks show as IN_PROGRESS (they belong to other sessions).

This ensures:

- Clean git state (no mixed changes across tasks in this session)
- Proper worktree management (one worktree per active task per session)
- Clear audit trail (each task has a complete lifecycle)

## Worker-Specific Requirements

**If you are running as a worker process**, you will have received a `workerId` in your prompt.

**CRITICAL:** Workers MUST pass their `workerId` to `load_task_session`:

```typescript
load_task_session({
  taskId: "...",
  sessionId: "...",
  workerId: "your-worker-id-from-prompt", // REQUIRED for workers
});
```

The MCP tool validates that workers pass their `workerId` for task queue validation.

## Task Lifecycle

Tasks flow: PLANNED → BACKLOG → READY → IN_PROGRESS → PR_REVIEW → COMPLETED (or ABANDONED from any state). See Status Transitions table below for details.

### SPIKE Task Detection

**Before starting implementation, check `task.type`.** If `SPIKE`, follow the SPIKE Execution Mode below instead of normal implementation flow. SPIKE tasks focus on investigation and discussion, not coding.

### SPIKE Execution Mode

**1. Start with Questions** - Before ANY research, ask clarifying questions (see example below).

**2. Research, Don't Code** - Document findings, compare options, surface risks. No production code (prototypes OK if requested). Never jump to a solution before exploring alternatives.

**3. Document and Present** - Use `log_task_progress` to record findings. Present options as:

```
Option A: [approach] - Pros: ... / Cons: ... / Effort: ...
Option B: [approach] - Pros: ... / Cons: ... / Effort: ...
Recommendation: [option] because [rationale]
```

**4. Complete** - No code written → use `force=true` to complete directly. Prototype written → PR as normal.

**Example:**

```
Task: SPIKE - Evaluate authentication approaches

Before I start researching, I have a few questions:
1. What authentication methods are you considering?
2. Are there specific providers you need to support?
3. What's your priority - simplicity, security, or flexibility?
4. Any constraints? (existing user system, compliance requirements)

Once I understand your requirements, I'll research and present a comparison.
```

### Status Transitions

| From        | To          | Trigger                                                                                                 |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| PLANNED     | BACKLOG     | `move_issue_to_backlog` (user satisfied with plan, creates GitHub issues unless `skipGitHubSync: true`) |
| BACKLOG     | IN_PROGRESS | `load_task_session` (also moves other BACKLOG → READY)                                                  |
| READY       | IN_PROGRESS | `load_task_session`                                                                                     |
| READY       | BACKLOG     | `pause_issue` (moves all READY tasks)                                                                   |
| IN_PROGRESS | IN_PROGRESS | `create_pr` (creates PR, status unchanged)                                                              |
| IN_PROGRESS | PR_REVIEW   | `submit_for_review` (after PR exists)                                                                   |
| IN_PROGRESS | COMPLETED   | `complete_task` with `force=true` (for SPIKE tasks with no code changes)                                |
| PR_REVIEW   | COMPLETED   | `complete_task` (after PR merged)                                                                       |
| Any         | ABANDONED   | `abandon_task`                                                                                          |
| COMPLETED   | (terminal)  | `end_worker_session` (workers only - signals worker process to terminate)                               |
| ABANDONED   | (terminal)  | `end_worker_session` (workers only - signals worker process to terminate)                               |

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

4. **Load the task session:**
   - Call `load_task_session` with task ID and session ID
   - This returns full context: task, issue, plan, worktree info
   - Response includes `resumed: boolean` - check this field:
     - `resumed: false` → Fresh start (BACKLOG/READY task)
     - `resumed: true` → Resuming existing session (IN_PROGRESS/PR_REVIEW task)
   - **If task is already COMPLETED or ABANDONED:** Response returns success with terminal state info (no error). Check `task.status` - if terminal, skip to "Terminal Task Recovery" below.
   - Review title, description, and acceptance criteria from the response

5. **If resuming (`resumed: true`):**
   - Call `get_task_execution_log` to read previous session's progress
   - Review the logged entries to understand what was already done
   - Summarize the previous progress to the user before continuing
   - Check `git status` in the worktree to see uncommitted changes
   - Continue from where the previous session left off

6. **Present task to user:**
   - Show what needs to be implemented
   - Show acceptance criteria as a checklist
   - Show worktree path and branch name
   - Offer to begin implementation

### To Create a PR and Submit for Review

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

### Monitor and Address PR Review (PR_REVIEW Loop)

Once the task is in PR_REVIEW, **do NOT passively wait for the PR to be merged.** Actively
loop — poll for feedback, address every actionable item, push, repeat — until there are no
unaddressed comments and the PR is merged. This mirrors the human review-triage mandate
(CLAUDE.md Mandate #2). Workers run this loop autonomously; interactive sessions run it too,
surfacing anything ambiguous to the user.

**Each iteration** (replace `<n>` with the PR number; get `<owner>/<repo>` from
`gh repo view --json nameWithOwner -q .nameWithOwner`):

1. **Poll every feedback source** (include bot reviewers — Copilot, Claude review):
   - Line comments (resolvable threads): `gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate`
   - Review submissions: `gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate`
   - PR-level comments: `gh api repos/<owner>/<repo>/issues/<n>/comments --paginate`
   - CI status: `gh pr checks`
2. **Triage each finding** — verify it against the CURRENT code at `HEAD`, not a superseded
   sha (beware stale comments pinned to an old commit). Fix the real ones; dismiss the rest
   with a one-line reason.
3. **Fix actionable items in code**, then rebase + re-run `make prep` (same as PR creation
   step 4 above) and push (`git push`, or `git push --force-with-lease` after a rebase).
4. **Reply to every finding** so the human can resolve it ("fixed in `<sha>` + how" or "not
   worth fixing because …"):
   - Line comments are threads → reply in-thread: `gh api -X POST repos/<owner>/<repo>/pulls/<n>/comments -f body=... -F in_reply_to=<comment_id>`
   - Review bodies + PR-level comments are not threaded → reply with a normal PR comment: `gh pr comment <n> --body ...`
5. **Re-check after every push** — each push can spawn a fresh bot review. Call
   `get_task_pr_status` for current PR state, then re-fetch and re-triage until a poll
   returns no new or unanswered comments AND the PR is merged.

A green-CI PR with unread or unanswered review comments is NOT done — keep looping (a human
or automation does the actual merge; the worker does not self-merge). Only once the PR is
merged do you proceed to "To Complete a Task" below.

### To Complete a Task

**IMPORTANT: `complete_task` requires a `finalLogEntry` parameter** - a summary of what was accomplished. This ensures every completed task has documentation of the work done.

> **⚠️ CRITICAL:** Task MUST be in PR_REVIEW before completing.
> If still IN_PROGRESS → call `submit_for_review` first.

1. **Verify PR is merged:**
   - Call `get_task_pr_status`
   - If not merged → return to the PR_REVIEW loop above (address open comments/CI, push) until it merges. Never complete a PR that isn't merged.

2. **Complete the task:**
   - Call `complete_task` with task ID, session ID, and `finalLogEntry`
   - **Workers:** Also pass `autoCloseIssue: true` to auto-close the issue if this is the last task
   - The `finalLogEntry` should summarize what was accomplished
   - This atomically: writes final log, verifies PR merged, pulls main, cleans up worktree/branch
   - Task transitions to COMPLETED
   - See "Auto-Closing Issues" below for behavior differences between workers and interactive sessions

3. **Report completion:**
   - Show task is now COMPLETED
   - Suggest next steps (next task, or done with issue)

### Auto-Closing Issues

**Workers:** Always pass `autoCloseIssue: true` when calling `complete_task`. The tool will automatically close the parent issue if all tasks are complete. No user confirmation needed.

**Interactive (non-worker) sessions:** The `complete_task` response includes `allTasksComplete` boolean.

| `allTasksComplete` | Action                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `true`             | Ask: "All tasks done. Close issue #N?" If yes → use `close_issue`       |
| `false`            | Do NOT ask about closing - just report completion and suggest next task |

### Terminal Action: end_worker_session (Workers Only)

After completing or abandoning a task, call `end_worker_session()`:

```typescript
end_worker_session({
  workerId: "your-worker-id", // From your worker prompt
  taskId: "task-uuid", // The task you worked on
});
```

**Complete Worker Flow:**

1. Load task → implement → create PR → submit for review
2. Run the PR_REVIEW loop (poll + address comments/CI, push) until merged → `complete_task` with `autoCloseIssue: true` (auto-closes if all tasks done)
3. **`end_worker_session()` ← TERMINAL (nothing after this)**

### To Abandon a Task

1. **Confirm abandonment:**
   - Ask user for the reason
   - Confirm they want to abandon (work will be lost)

2. **Abandon the session:**
   - Call `abandon_task` with task ID, session ID, and reason
   - Worktree and branch will be deleted

3. **Report and suggest:**
   - Show task is now ABANDONED
   - Suggest alternatives (different approach, re-plan issue)

4. **(Workers only) Call `end_worker_session()`** - same terminal semantics apply

### To Pause an Issue

Call `pause_issue` with issue number → moves all READY tasks to BACKLOG. Starting any task resumes work (BACKLOG → READY). Only affects READY tasks.

### Terminal Task Recovery

When `load_task_session` returns a task in COMPLETED or ABANDONED state, the response includes:

| Field              | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `success`          | Always `true` (not an error)                           |
| `task`             | The task with terminal status                          |
| `issue`            | Parent issue context                                   |
| `plan`             | Plan context                                           |
| `allTasksComplete` | Whether all tasks in the plan are in terminal state    |
| `nextTask`         | Next available task in the same plan (if any)          |
| `message`          | "Task is already COMPLETED/ABANDONED. No work needed." |

**Recovery actions:**

1. **If `nextTask` exists:** Offer to start the next task instead
2. **If `allTasksComplete: true`:** Report that all tasks are done, offer to close the issue
3. **If `allTasksComplete: false` and no `nextTask`:** Other tasks may be blocked or in progress by other sessions

**Workers:** If task is already terminal, call `end_worker_session()` immediately - nothing to do.

## CRITICAL: Worktree Path

Every task runs in its own isolated git worktree. **Workers** pre-create that worktree and spawn your session already standing inside it; `load_task_session` then **adopts** the existing worktree (it does not create a second one) and **returns its `worktreePath`**. For **inline** (non-worker) execution, `load_task_session` creates the worktree itself and returns the path. Either way, the returned `worktreePath` is the one source of truth.

You MUST use the returned `worktreePath` for ALL file operations during the task:

- **Read/Edit/Write tools**: Always use the full worktree path (e.g., `/Users/.../.track/project/worktrees/issue-N-task-N/path/to/file`)
- **Bash commands**: Always `cd` to the worktree path or use absolute paths within the worktree
- **Glob/Grep tools**: Always specify the worktree path in the `path` parameter

**NEVER** fall back to the main repo path. The main repo may be on a different branch or have different content. All changes for the PR must be made in the worktree. (As a worker your cwd already IS the worktree, but still resolve paths against the returned `worktreePath` rather than assuming cwd.)

```
❌ Read("/Users/user/code/project/Makefile")           # Main repo - WRONG
✅ Read("/Users/user/.track/project/worktrees/issue-1-task-1/Makefile")  # Worktree - CORRECT
```

## Example Interactions

### Starting a Task

**User:** "Start working on the first task"

```
Task: Add OAuth2 authentication with Google provider
Branch: issue-5/task-1-add-oauth
Worktree: ~/.track/project-abc/worktrees/issue-5-task-1

Acceptance Criteria:
- [ ] OAuth callback processes Google auth correctly
- [ ] Access tokens securely stored
- [ ] Unit tests achieve 80%+ coverage

Task is now IN_PROGRESS. Ready to begin?
```

### Creating PR → Submit for Review

```
Summary: Added OAuth flow, callback handler, tests (92% coverage)
Acceptance Criteria: ✓ All met
Validation: PASSED

PR #42 created. Task still IN_PROGRESS.
Submit for review now?
```

**User:** "yes" → Task transitions to PR_REVIEW

### Completing a Task

**After PR merged:**

```
PR #42: MERGED
Task COMPLETED. Next task available: "Add session management"
```

**SPIKE with no code changes:** Summarize → confirm → `complete_task` with `force=true` → COMPLETED

## Error Handling

### MCP Server Connection Issues (rare — backstop)

**When MCP tools return unexpected "not found" errors for data that should exist:**

This is now **rare**. Project resolution is worktree-aware: a session whose cwd is a task worktree resolves to the parent repo's project, and workers run inside the correct worktree from the start — so the old "running from a worktree connects the MCP to the wrong database" failure mode is largely gone. Treat this section as a backstop, not the expected outcome.

If you were working on an issue/task and suddenly get "Issue not found" or "Task not found" errors that don't resolve via the recovery steps below, the MCP server may still be connected to the wrong database.

**If that happens, STOP. Do NOT try to work around it.**

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
| Create PR failed - no branch     | Check worktree setup; abandon and retry if needed          |
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

| Tool                | What force bypasses                                      |
| ------------------- | -------------------------------------------------------- |
| `create_pr`         | IN_PROGRESS status check                                 |
| `submit_for_review` | IN_PROGRESS status check and PR existence check          |
| `complete_task`     | Status check (allows completing from wrong status)       |
| `abandon_task`      | Session ownership check (allows abandoning orphan tasks) |
| `close_issue`       | Task completion check (allows closing with open tasks)   |

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

- Session timeout is 1 hour of inactivity
- Abandoned tasks can inform re-planning
- Always show acceptance criteria when starting a task

### Task Tuning

Before execution, tasks can be tuned using `update_task`:

- **implementationPlan**: Add technical implementation details (e.g., "use existing auth pattern in src/auth")
- **acceptanceCriteria**: Refine what needs to be verified
- **description**: Clarify implementation details

## Progress Logging for Session Continuity

Log at **milestones only** so the next session can pick up if this one ends unexpectedly.

| Task Type | Log Frequency                             |
| --------- | ----------------------------------------- |
| Feature   | 2-4 entries (approach, milestones)        |
| Bug       | 3-5 entries (hypotheses, root cause, fix) |
| Simple    | 0 entries - just use `finalLogEntry`      |

**Good:** `log_task_progress({ message: "Implemented OAuth callback. Added tests.", filesModified: [...] })`

**Bad:** Logging routine operations like "Reading file X" or "Running tests"

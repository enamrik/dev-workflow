---
name: work-task
description: Manage task execution lifecycle - start, complete, or abandon tasks. Auto-invoked when user wants to "start task", "work on task", "complete task", "finish task", "abandon task", etc.
allowed-tools: mcp:dev-workflow-tracker:get_task_for_session, mcp:dev-workflow-tracker:start_task_session, mcp:dev-workflow-tracker:complete_task_session, mcp:dev-workflow-tracker:abandon_task_session, mcp:dev-workflow-tracker:list_available_tasks, mcp:dev-workflow-tracker:get_plan
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

## Task Lifecycle

```
PENDING → IN_PROGRESS → COMPLETED
              ↓
          ABANDONED
```

### Starting a Task

When starting a task:
1. **Pre-start hooks run** (must pass)
2. Task status changes to IN_PROGRESS
3. **Post-start hooks run** (informational)
4. Session is associated with the task

### Completing a Task

When completing a task:
1. **Pre-complete hooks run** (must pass - e.g., tests)
2. Task status changes to COMPLETED
3. **Post-complete hooks run** (informational)
4. Session is cleared

### Abandoning a Task

When abandoning a task:
1. **On-abandon hooks run** (informational)
2. Task status changes to ABANDONED
3. Session is cleared
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
   - Note any hook configurations

3. **Start the session:**
   - Call `start_task_session` with task ID and session ID
   - If pre-start hooks fail → explain what failed and how to fix
   - If successful → show task details and begin work

4. **Present task to user:**
   - Show what needs to be implemented
   - Show acceptance criteria as a checklist
   - Offer to begin implementation

### To Complete a Task

1. **Verify work is done:**
   - Review acceptance criteria
   - Confirm all criteria are met
   - Ask user to confirm if unclear

2. **Complete the session:**
   - Call `complete_task_session` with task ID and session ID
   - If pre-complete hooks fail (e.g., tests fail) → explain what failed
   - Pre-complete hooks MUST pass to complete the task

3. **Report completion:**
   - Show task is now COMPLETED
   - Suggest next steps (next task, or done with issue)

### To Abandon a Task

1. **Confirm abandonment:**
   - Ask user for the reason
   - Confirm they want to abandon (work will be lost)

2. **Abandon the session:**
   - Call `abandon_task_session` with task ID, session ID, and reason
   - On-abandon hooks run for cleanup

3. **Report and suggest:**
   - Show task is now ABANDONED
   - Suggest alternatives (different approach, re-plan issue)

## Hook System

Tasks can have lifecycle hooks configured via labels. Common hooks:

- **unit-tests**: Runs unit tests before completion
- **e2e-tests**: Runs end-to-end tests
- **db-migration**: Handles database migration checks
- **security**: Security scanning
- **performance**: Performance benchmarks

Hooks are defined in `.track/issues/tasks/hooks/<label>.yml` files.

### Hook Stages

| Stage | When | Must Pass? |
|-------|------|------------|
| preStart | Before IN_PROGRESS | Yes |
| postStart | After IN_PROGRESS | No |
| preComplete | Before COMPLETED | Yes |
| postComplete | After COMPLETED | No |
| onAbandon | When abandoned | No |

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

Pre-start hooks passed. Task is now IN_PROGRESS.

Ready to begin implementation. Where would you like to start?
```

### Completing a Task

**User:** "I've finished the task, tests are passing"

**Response:**
```
Completing task session...

Running pre-complete hooks:
  - unit-tests: Running... PASSED
  - e2e-tests: Running... PASSED

All hooks passed!

Task "Add OAuth2 authentication with Google provider" is now COMPLETED.

Next available task: "Add session management and user profile"
Would you like to start working on it?
```

### Hook Failure

**User:** "Complete the task"

**Response:**
```
Completing task session...

Running pre-complete hooks:
  - unit-tests: Running... FAILED
    > 3 tests failing in auth.test.ts
    > Expected token refresh, got null

Pre-complete hooks must pass to complete the task.

Please fix the failing tests and try again. Would you like help debugging?
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

## Notes

- Only ONE task should be in progress at a time per session
- Pre-complete hooks enforce quality gates (tests must pass)
- Session timeout is 1 hour of inactivity
- Abandoned tasks can inform re-planning
- Always show acceptance criteria when starting a task

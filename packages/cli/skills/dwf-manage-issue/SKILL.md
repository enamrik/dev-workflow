---
name: dwf-manage-issue
description: "⚠️ For NEW work requests, use 'dwf-work-request' first - it routes here automatically. This skill handles the mechanics: requirements separation, template selection, priority/milestone assignment. Only invoke directly for EDITING existing issues: 'update issue #N', 'add acceptance criteria to #5', 'change priority of #3'. (project)"
allowed-tools: mcp:dev-workflow-tracker:create_issue, mcp:dev-workflow-tracker:get_issue, mcp:dev-workflow-tracker:update_issue, mcp:dev-workflow-tracker:list_templates, mcp:dev-workflow-tracker:list_available_task_labels, mcp:dev-workflow-tracker:list_milestones, mcp:dev-workflow-tracker:get_milestone, mcp:dev-workflow-tracker:assign_issue_to_milestone, mcp:dev-workflow-tracker:move_issue_to_backlog
---

# Manage Issue Skill

## When to Invoke

**This skill is typically invoked by `dwf-work-request`** when the user describes work to be done. It can also be invoked directly for:

**Explicit create operations:**
- User mentions: "create issue", "new feature", "report bug", "add enhancement", "add task"
- User requests tracking: "track this", "make an issue for this"

**Update operations:**
- User mentions: "update issue #N", "change issue", "modify requirements"
- User wants to edit: "add acceptance criteria to #5", "change the description"
- User references existing issue: "issue #3 needs more detail"

## Information Levels

When users describe what they want, they often mix different levels of detail. You MUST separate these:

| Level | Belongs In | What It Answers | Examples |
|-------|-----------|-----------------|----------|
| **Requirements** | Issue | WHAT does the user want? | "Add user authentication", "Users should be able to sign in" |
| **Approach** | Plan | HOW will we build it? | "Use passport.js", "Store sessions in Redis", "OAuth with Google" |
| **Specifics** | Tasks | WHERE exactly in the code? | "Callback at /auth/callback", "Add column to users table" |

### How to Separate

**Put in the ISSUE:**
- User-facing requirements (what the user wants to achieve)
- Acceptance criteria (how we know it's done)
- Business constraints (must work on mobile, must be fast)
- Non-functional requirements (security, performance)

**Pass to PLANNING (not in issue):**
- Technology choices (which library, which database)
- Architecture decisions (where to put the code, what pattern to use)
- Implementation approach (sync vs async, REST vs GraphQL)

**Let TASKS capture:**
- Specific file paths and function names
- Exact API endpoints and routes
- Database column names and types
- Configuration values

### Example Separation

**User says:** "I want to add user authentication with OAuth. We should use passport.js and store sessions in Redis. The callback should be at /auth/callback."

**Issue should contain:**
- Title: "Add user authentication with OAuth"
- Description: "Users should be able to sign in using OAuth providers"
- Acceptance criteria: "User can sign in", "Session persists", "Logout works"

**Pass to planning:** "Use passport.js", "Store sessions in Redis"

**Let tasks capture:** "Callback at /auth/callback"

When creating the issue, mention that implementation details will be captured in the plan:
> "I've noted the implementation preferences (passport.js, Redis). These will be incorporated into the implementation plan."

## Process

### For Creating Issues

1. **Analyze and SEPARATE information levels:**
   - Extract REQUIREMENTS → these go in the issue
   - Identify APPROACH details → hold these for planning
   - Note SPECIFICS → these will go into tasks

   Ask yourself: "Is this what the user wants, or how to build it?"

2. **Gather requirement-level information:**
   - If user provided requirements → proceed
   - If user only provided implementation details → ask for requirements:
     - "What's the user-facing goal here?"
     - "What should users be able to do when this is done?"
     - "How will we know this feature is complete?"
   - If missing acceptance criteria → ask:
     - "What are the acceptance criteria?"

3. **Select template (optional):**
   - Call `list_templates` to see available templates
   - Auto-select based on issue type:
     - Keywords "bug", "error", "broken", "failing" → bug template
     - Keywords "feature", "add", "implement", "new" → feature template
     - Keywords "improve", "optimize", "enhance" → enhancement template

4. **Create issue (requirements only):**
   - Call `create_issue` with requirement-level information
   - Do NOT put implementation details in the issue description
   - Acceptance criteria should be verifiable outcomes, not implementation steps
   - **Issues are created in PLANNED status** (no GitHub sync yet)

5. **Report and chain to planning WITH context:**
   - Show issue number (#N)
   - Summarize what was created
   - Mention that implementation details will be in the plan
   - Pass the approach/specifics context to planning phase

### For Updating Issues

1. **Get current issue:**
   - Call `get_issue` with the issue number
   - Show current state to user

2. **Determine changes:**
   - What fields need updating? (title, description, acceptance criteria, status, priority, labels)
   - Confirm changes with user if ambiguous

3. **Update issue:**
   - Call `update_issue` with the changes

4. **Report and chain to planning:**
   - Show what was changed
   - If description or acceptance criteria changed, proceed to re-plan implementation tasks

### For Closing Issues

**IMPORTANT: Always ask user for confirmation before closing an issue.**

1. **Verify all tasks are complete:**
   - Check that all tasks in the plan are COMPLETED or ABANDONED
   - If tasks remain BACKLOG, READY, or IN_PROGRESS, do not close

2. **Ask for confirmation:**
   - Summarize what was accomplished
   - Ask: "Should I close this issue?"
   - Wait for explicit user approval before proceeding
   - Do NOT call `update_issue` with `status: "CLOSED"` without user saying yes

3. **Close the issue (only after user confirms):**
   - Call `update_issue` with `status: "CLOSED"`

4. **Report closure:**
   - Confirm the issue is now CLOSED
   - Suggest next steps if applicable (other open issues, new work)

### Approving Plans (PLANNED → OPEN)

**IMPORTANT: NEVER automatically start work. ALWAYS ask user if they're satisfied with the plan first.**

When an issue has a plan with PLANNED tasks and the user wants to start work:

1. **Ask if user is satisfied with the plan:**
   - Show the plan summary and task list
   - Ask: "Are you satisfied with this plan? Ready to start working on it?"
   - Wait for explicit user approval

2. **Only after user confirms:**
   - Call `move_issue_to_backlog` with the issue number
   - This transitions: Issue PLANNED → OPEN, Tasks PLANNED → BACKLOG
   - If GitHub sync is enabled, creates GitHub issues for each task

3. **Report that work can begin:**
   - Confirm the issue is now OPEN
   - Show how many tasks are now available to work on
   - If GitHub sync is enabled, mention GitHub issues were created

**Do NOT call `move_issue_to_backlog` automatically.** This must always be user-initiated.

**Detection:** If you see an issue in PLANNED status with PLANNED tasks, prompt the user:
> "Issue #N has a plan ready. Are you satisfied with it? Would you like to start working on it?"

## Priority Extraction

If user mentions specific priority/urgency:
- "high priority bug", "critical issue" → priority: HIGH or CRITICAL
- "urgent feature", "asap" → priority: CRITICAL
- "low priority", "nice to have" → priority: LOW

## Milestone Detection

If user mentions a milestone when creating or updating an issue:
1. **Look for milestone references:**
   - "for M1", "part of M2", "in milestone 3"
   - "for the Q1 release", "in the MVP milestone"
   - "belongs to M1"

2. **Lookup the milestone:**
   - Call `list_milestones` to find available milestones
   - Match by number (M1, M2) or title keywords

3. **After issue creation, assign to milestone:**
   - Call `assign_issue_to_milestone` with the issue number and milestone number
   - Report the assignment in your response

**Example:**
User: "Create an issue to add user authentication for M2"
1. Create the issue normally
2. Call `assign_issue_to_milestone` with `issueNumber` and `milestoneNumber: 2`
3. Report: "Created issue #5 and assigned to milestone M2"

## Label Extraction

**IMPORTANT: Labels must exist before assignment.** Before assigning labels:
1. Call `list_available_task_labels` to see what labels exist
2. Only use labels that have a corresponding file in `.track/labels/`
3. If no matching label file exists, do NOT assign that label

Only use labels from the available labels list. Do not invent labels.

## After Success

**MANDATORY:** After successfully creating or updating an issue, you MUST invoke the `dwf-plan-issue` skill to generate an implementation plan. Do NOT ask the user if they want a plan - just create it.

**Required action:** Call the Skill tool with `skill: "dwf-plan-issue"` and pass the issue number.

Example flow:
1. Create issue → get issue #N
2. Immediately invoke: `Skill(skill: "dwf-plan-issue", args: "#N")`
3. The plan skill will generate tasks automatically

This ensures every issue gets a plan with deployable task units. Never skip this step.

## Error Handling

If MCP tool call fails:
- Explain the error clearly
- Suggest troubleshooting steps:
  - Is dev-workflow initialized? (run `dev-workflow init`)
  - Is the MCP server running?
  - Check `.claude/config/mcp-servers.json`
- Offer to help diagnose the issue

## Example Interactions

### Creating an Issue (with information level separation)

**User:** "I want to add user authentication with OAuth. We should use passport.js and store sessions in Redis. The callback should be at /auth/callback and we need rate limiting on the login endpoint."

**Response:**
```
I'll create an issue capturing the requirements. I've noted your implementation
preferences (passport.js, Redis, /auth/callback endpoint, rate limiting) -
these will be incorporated into the implementation plan.

Issue created: #1 - Add user authentication with OAuth
  Type: FEATURE
  Priority: MEDIUM

  Description:
  Users should be able to sign in using OAuth providers.

  Acceptance Criteria:
  - [ ] User can sign in with OAuth
  - [ ] Session persists across browser refresh
  - [ ] User can sign out
  - [ ] Login attempts are rate limited

Now let me create an implementation plan for issue #1. I'll incorporate your
technical preferences: passport.js for OAuth handling, Redis for session
storage, callback endpoint at /auth/callback.
```

Notice: The issue contains WHAT (requirements), while HOW (passport.js, Redis)
goes to the plan, and WHERE (/auth/callback) goes to tasks.

### User Provides Only Implementation Details

**User:** "We need to add a new column to the users table for storing OAuth tokens and create a background job to refresh them"

**Response:**
```
I see implementation details, but I need to understand the requirement first.

What's the user-facing goal here? For example:
- "Users should be able to sign in with Google"
- "Sessions should persist longer"
- "Users shouldn't have to re-authenticate frequently"

What should users be able to do when this is done?
```

### Updating an Issue

**User:** "Update issue #1 to also include GitHub OAuth"

**Response:**
```
Updated issue #1:
  Added to acceptance criteria:
  - [ ] User can sign in with GitHub OAuth

Since requirements changed, let me re-plan the implementation tasks for issue #1.
```

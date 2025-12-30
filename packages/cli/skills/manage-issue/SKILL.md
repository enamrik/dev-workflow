---
name: manage-issue
description: Create or update issues in the task tracker. Auto-invoked when user wants to "create issue", "new feature", "report bug", "update issue", "change requirements", etc.
allowed-tools: mcp:dev-workflow-tracker:create_issue, mcp:dev-workflow-tracker:get_issue, mcp:dev-workflow-tracker:update_issue, mcp:dev-workflow-tracker:list_templates
---

# Manage Issue Skill

## When to Invoke

**Create operations:**
- User mentions: "create issue", "new feature", "report bug", "add enhancement", "add task"
- User describes work: "I want to add authentication", "There's a bug in the login"
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

## Priority Extraction

If user mentions specific priority/urgency:
- "high priority bug", "critical issue" → priority: HIGH or CRITICAL
- "urgent feature", "asap" → priority: CRITICAL
- "low priority", "nice to have" → priority: LOW

## Label Extraction

If user mentions categories or tags:
- "authentication feature" → labels: ["authentication"]
- "UI bug" → labels: ["ui"]
- Extract relevant labels from description

## After Success

After successfully creating or updating an issue, immediately proceed to plan the implementation tasks for this issue.

Say something like: "Now let me create an implementation plan for issue #N with properly-scoped tasks."

This ensures every issue gets a plan with deployable task units.

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

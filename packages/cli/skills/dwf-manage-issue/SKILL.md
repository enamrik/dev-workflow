---
name: dwf-manage-issue
description: "⚠️ For NEW work requests, use 'dwf-work-request' first - it routes here automatically. This skill handles the mechanics: requirements separation, template selection, priority/milestone assignment. Only invoke directly for EDITING existing issues: 'update issue #N', 'add acceptance criteria to #5', 'change priority of #3'. (project)"
allowed-tools: mcp:dev-workflow-tracker:create_issue, mcp:dev-workflow-tracker:get_issue, mcp:dev-workflow-tracker:update_issue, mcp:dev-workflow-tracker:close_issue, mcp:dev-workflow-tracker:list_templates, mcp:dev-workflow-tracker:list_milestones, mcp:dev-workflow-tracker:get_milestone, mcp:dev-workflow-tracker:assign_issue_to_milestone, mcp:dev-workflow-tracker:move_issue_to_backlog, mcp:dev-workflow-tracker:import_github_issue, mcp:dev-workflow-tracker:merge_issues
---

# Manage Issue Skill

## MCP Server Connection Failures (CRITICAL)

**If MCP tools return unexpected "not found" errors for data that should exist, STOP IMMEDIATELY.**

This indicates the MCP server is connected to the wrong database. **Do NOT work around it** with manual database updates, `gh` CLI, or any other method - this creates corrupt, inconsistent state.

**Action:** Tell the user: "The MCP server appears to be connected to the wrong database. Please restart your Claude session to reconnect, then we can resume."

---

## When to Invoke

**This skill is typically invoked by `dwf-work-request`** when the user describes work to be done. It can also be invoked directly for:

**Explicit create operations:**

- User mentions: "create issue", "new feature", "report bug", "add enhancement", "add task"
- User requests tracking: "track this", "make an issue for this"

**Import operations:**

- User mentions: "import #N", "import issue #N", "import GitHub issue"
- User provides URL: "import https://github.com/owner/repo/issues/42"
- User wants to work on external issue: "work on GitHub issue #42"

**Update operations:**

- User mentions: "update issue #N", "change issue", "modify requirements"
- User wants to edit: "add acceptance criteria to #5", "change the description"
- User references existing issue: "issue #3 needs more detail"

**Merge operations:**

- User mentions: "merge #X and #Y", "combine issues #X and #Y"
- User wants to consolidate: "merge #5 into #3", "fold #2 into #1"
- User identifies duplicates: "these issues are duplicates", "combine these"

## Information Levels

When users describe what they want, they often mix different levels of detail. You MUST separate these:

| Level            | Belongs In | What It Answers            | Examples                                                          |
| ---------------- | ---------- | -------------------------- | ----------------------------------------------------------------- |
| **Requirements** | Issue      | WHAT does the user want?   | "Add user authentication", "Users should be able to sign in"      |
| **Approach**     | Plan       | HOW will we build it?      | "Use passport.js", "Store sessions in Redis", "OAuth with Google" |
| **Specifics**    | Tasks      | WHERE exactly in the code? | "Callback at /auth/callback", "Add column to users table"         |

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
   - **Display the issue URL** from the `create_issue` response (the `url` field)
   - Summarize what was created
   - Mention that implementation details will be in the plan
   - Pass the approach/specifics context to planning phase

### For Updating Issues

1. **Get current issue:**
   - Call `get_issue` with the issue number
   - Show current state to user

2. **Determine changes:**
   - What fields need updating? (title, description, acceptance criteria, status, priority)
   - Confirm changes with user if ambiguous

3. **Update issue:**
   - Call `update_issue` with the changes

4. **Report and chain to planning:**
   - Show what was changed
   - If description or acceptance criteria changed, proceed to re-plan implementation tasks

### For Importing GitHub Issues

Import allows users to bring existing GitHub issues into dev-workflow for structured planning and task execution. The imported issue maintains a link to the source GitHub issue.

1. **Detect import request:**
   - User says "import #N" or "import issue #N" → import by number
   - User provides GitHub URL → parse the issue number from URL
   - User says "work on GitHub issue #N" → treat as import

2. **Call import_github_issue:**

   ```
   import_github_issue(githubIssueNumber: 42)
   // OR
   import_github_issue(githubIssueUrl: "https://github.com/owner/repo/issues/42")
   ```

   - Fetches the GitHub issue via `gh api`
   - Creates a dev-workflow issue with title/description from GitHub
   - Stores `sourceGitHubIssueNumber` to mark it as imported
   - Does NOT create tasks - planning handles that

3. **Report and chain to planning:**
   - Show the new issue number (#N)
   - Display the issue URL
   - Mention it was imported from GitHub issue #X
   - Chain to `dwf-plan-issue` just like a new issue

4. **Planning and backlog (handled by other skills):**
   - Planning works normally - `generate_plan` creates tasks
   - When `move_issue_to_backlog` is called for an imported issue:
     - **1 task:** Links task directly to the imported GitHub issue (no new GitHub issue)
     - **N tasks:** Creates GitHub sub-issues under the imported parent
     - **With `skipGitHubSync: true`:** No GitHub issues created, tasks only tracked locally

**Key insight:** The imported GitHub issue represents the "epic" or parent. If implementation requires multiple PRs (deployable units), each task becomes a sub-issue linked to the parent. Use `skipGitHubSync: true` if you want to track the work locally without creating GitHub sub-issues.

### For Closing Issues

**IMPORTANT: Always ask user for confirmation before closing an issue.**

1. **Ask for confirmation:**
   - Summarize what was accomplished
   - Ask: "Should I close this issue?"
   - Wait for explicit user approval before proceeding
   - Do NOT call `close_issue` without user saying yes

2. **Close the issue (only after user confirms):**
   - Call `close_issue` with the issue number
   - The tool validates all tasks are in terminal state (COMPLETED or ABANDONED)
   - If tasks remain, the tool will return an error listing incomplete tasks

3. **Report closure:**
   - Confirm the issue is now CLOSED
   - Suggest next steps if applicable (other open issues, new work)

### For Merging Issues

Merge allows users to combine two issues into one. This is useful when issues are discovered to be duplicates, highly related, or when work needs to be consolidated.

**Two merge modes:**

| Mode         | What Happens                                       | When to Use                                  |
| ------------ | -------------------------------------------------- | -------------------------------------------- |
| `create_new` | Creates a new issue from both, originals unchanged | Combining related work into fresh issue      |
| `merge_into` | Folds source into target, source is soft-deleted   | True duplicates, consolidating into existing |

1. **Detect merge request:**
   - User says "merge #X and #Y" → ask which mode
   - User says "merge #X into #Y" → use `merge_into` mode (X is source, Y is target)
   - User says "combine issues" → ask which issues and which mode

2. **Confirm with user:**
   - Show both issues briefly (number, title, status)
   - If mode not specified, ask: "Would you like to create a new issue from both, or merge one into the other?"
   - If `merge_into`, clarify: "This will fold #X into #Y and soft-delete #X. Continue?"

3. **Call merge_issues:**

   ```
   merge_issues(
     sourceIssueNumber: X,
     targetIssueNumber: Y,
     mode: "create_new" | "merge_into"
   )
   ```

   - For `create_new`: Both X and Y become source issues, result is a new issue
   - For `merge_into`: X is folded into Y, X is soft-deleted

4. **Handle warnings:**
   - The tool returns warnings for in-progress or PR-review tasks
   - Show these warnings to the user: "Note: Task 'X' is currently in progress and will be preserved in its current state."
   - Warnings are informational - they don't block the merge

5. **Report result:**
   - Show the resulting issue number and title
   - Show how many tasks were merged
   - For `merge_into`: confirm source issue was soft-deleted
   - For `create_new`: confirm original issues are unchanged

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
   - **To skip GitHub sync:** If user explicitly requests no GitHub issues (e.g., "don't create GitHub issues", "skip GitHub sync", "internal only"), call `move_issue_to_backlog` with `skipGitHubSync: true`

3. **Report that work can begin:**
   - Confirm the issue is now OPEN
   - Show how many tasks are now available to work on
   - If GitHub sync is enabled (and not skipped), mention GitHub issues were created

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

### Creating an Issue (information level separation)

**User:** "Add OAuth auth with passport.js, Redis sessions, callback at /auth/callback"

```
Issue created: #1 - Add user authentication with OAuth
  Type: FEATURE | Priority: MEDIUM
  URL: http://127.0.0.1:3456/projects/{projectId}/issues/1

  Acceptance Criteria:
  - [ ] User can sign in with OAuth
  - [ ] Session persists across browser refresh

Implementation details (passport.js, Redis, /auth/callback) noted for plan.
```

**If user provides only implementation details**, ask: "What's the user-facing goal? What should users be able to do when this is done?"

### Importing a GitHub Issue

**User:** "Import issue #42" (or provide URL)

```
Issue imported: #5 - Add dark mode support
  Source: GitHub issue #42
  URL: http://127.0.0.1:3456/projects/{projectId}/issues/5

Now creating implementation plan...
```

When moved to backlog: 1 task links to GitHub #42 directly; N tasks create sub-issues.

### Merging Issues

**User:** "Merge #3 and #5"

1. Show both issues briefly
2. Ask: "Create new issue from both, or merge one into the other?"
3. `merge_issues(source, target, mode: "create_new" | "merge_into")`
4. Report result + any warnings about in-progress tasks

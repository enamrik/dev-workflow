---
name: dwf-work-request
description: "⚠️ ENTRY POINT for ALL new work, regardless of size. Invoke FIRST when user wants anything built, fixed, added, or created - even 'trivial' fixes. Triggers: 'add X', 'fix Y', 'implement Z', 'create issue', 'we need...', 'can you build...', 'make it...'. Do NOT use dwf-manage-issue directly for new work - use this router instead."
---

# Work Request Skill

## MCP Server Connection Failures (CRITICAL)

**If MCP tools return unexpected "not found" errors for data that should exist, STOP IMMEDIATELY.**

This indicates the MCP server is connected to the wrong database. **Do NOT work around it** with manual database updates, `gh` CLI, or any other method - this creates corrupt, inconsistent state.

**Action:** Tell the user: "The MCP server appears to be connected to the wrong database. Please restart your Claude session to reconnect, then we can resume."

---

> **⚠️ SIZE DOES NOT MATTER**: A 2-line fix gets an issue. A 200-line feature gets an issue. Do not invent exceptions based on perceived complexity or effort. If code changes, track it.

## Purpose

All work should be tracked as issues before implementation begins. This ensures:

- Requirements are captured and clarified upfront
- Work is visible and searchable
- Progress can be tracked
- Nothing gets forgotten or half-done

## When This Skill Activates

This skill should activate whenever the user describes work to be done:

| User Says                                | This Is Work                 |
| ---------------------------------------- | ---------------------------- |
| "Add a logout button"                    | Feature request              |
| "Fix the login bug"                      | Bug report                   |
| "Can you implement dark mode?"           | Feature request              |
| "We need better error handling"          | Enhancement                  |
| "Refactor the API layer"                 | Technical task               |
| "Make the search faster"                 | Performance improvement      |
| "Look into why X is slow"                | Investigation (likely a bug) |
| "X isn't working as expected"            | Bug investigation            |
| "We need to investigate Y"               | Bug investigation            |
| "Build a dashboard for..."               | Feature request              |
| "Update the form to include..."          | Enhancement                  |
| "Import #42"                             | Import existing GitHub issue |
| "Import issue #42"                       | Import existing GitHub issue |
| "Import github.com/owner/repo/issues/42" | Import existing GitHub issue |

## What To Do

When you recognize a work request:

1. **Acknowledge the request** - Show you understand what they want
2. **Invoke `dwf-manage-issue`** - This skill handles issue creation with proper requirements separation
3. **Do NOT start coding** - Implementation comes after the issue and plan exist

## Import Requests

**Import** is a special type of work request where the user wants to bring an existing GitHub issue into dev-workflow for structured planning and task execution.

### Detection Patterns

- "import #N" or "import issue #N" - Import by issue number
- "import https://github.com/owner/repo/issues/N" - Import by URL
- "pull in GitHub issue #N" - Alternative phrasing
- "work on GitHub issue #N" - User wants to work on an external issue

### Routing

Import requests route to `dwf-manage-issue` with import context. The manage-issue skill has an "Import Operations" section that handles:

1. Calling `import_github_issue` to create a linked dev-workflow issue
2. Chaining to planning (just like create-new)
3. The move-to-backlog phase handles sub-issue creation if needed

### Import vs Create-New

| Scenario                              | Action                            |
| ------------------------------------- | --------------------------------- |
| User describes new work to build      | Create new issue → plan → work    |
| User references existing GitHub issue | Import GitHub issue → plan → work |

**Key difference:** Import preserves the link to the source GitHub issue. When moved to backlog with multiple tasks, GitHub sub-issues are created under the imported parent (unless `skipGitHubSync: true` is specified).

## Exceptions - When NOT to Track

Skip issue creation only when:

- User explicitly says "don't create an issue" or "just do it quick"
- User is just asking questions, not requesting work
- **Pure exploration** - User is exploring/reading code to understand how it works (e.g., "how does the auth system work?", "explain this code")

**IMPORTANT**: "Trivial fix" is NOT an exception. ALL code changes go through issues, regardless of size. This ensures work is tracked and visible.

## Bug Investigations Need Issues

**Important distinction:** If the user reports unexpected behavior or asks you to investigate something that isn't working correctly, this is bug investigation - NOT pure exploration.

- **Pure exploration** (no issue): "How does the routing work?" / "Explain this function"
- **Bug investigation** (needs issue): "The UI is showing stale data" / "Why isn't X working?" / "We need to investigate this"
- **Question that reveals a bug** (needs issue): "Why does X show Y?" → if investigation reveals incorrect behavior, create an issue BEFORE fixing

For bug investigations:

1. Start investigating to confirm the issue exists
2. **Once you confirm it's a bug**, create an issue to track it
3. Continue investigation and fix as part of that issue

**CRITICAL**: Do NOT fix bugs inline after discovering them. Once you identify something as a bug, STOP and create an issue. Then fix it as part of that tracked issue. This applies even if the fix is obvious or simple.

When in doubt, create the issue. It takes seconds and prevents lost work.

## How to Invoke manage-issue

After this skill activates, immediately invoke the `dwf-manage-issue` skill:

```
Skill(skill: "dwf-manage-issue")
```

Pass along any context the user provided - requirements, preferences, constraints. The manage-issue skill will:

- Separate requirements from implementation details
- Create the issue with proper structure
- Chain to planning automatically

## Example Flow

### Creating New Work

**User:** "Can you add a way for users to export their data as CSV?"

**Your response:**

```
I'll track this as an issue so we can plan it properly.

[Invoke dwf-manage-issue skill]
```

The manage-issue skill takes over from here, creating the issue and then the implementation plan.

### Importing Existing GitHub Issue

**User:** "Import issue #42"

**Your response:**

```
I'll import GitHub issue #42 into dev-workflow so we can plan and track the implementation.

[Invoke dwf-manage-issue skill with import context]
```

The manage-issue skill will call `import_github_issue` to fetch the GitHub issue details and create a linked dev-workflow issue, then chain to planning.

---
name: dfl-manage-milestone
description: Manage milestones - time-bounded goals that group related issues. Use for creating, updating, and organizing issues into milestones for project planning.
allowed-tools: mcp:dev-workflow-tracker:create_milestone, mcp:dev-workflow-tracker:get_milestone, mcp:dev-workflow-tracker:list_milestones, mcp:dev-workflow-tracker:update_milestone, mcp:dev-workflow-tracker:delete_milestone, mcp:dev-workflow-tracker:assign_issue_to_milestone, mcp:dev-workflow-tracker:remove_issue_from_milestone, mcp:dev-workflow-tracker:search_issues
---

# Manage Milestone Skill

## MCP Server Connection Failures (CRITICAL)

**If MCP tools return unexpected "not found" errors for data that should exist, STOP IMMEDIATELY.**

This indicates the MCP server is connected to the wrong database. **Do NOT work around it** with manual database updates, `gh` CLI, or any other method - this creates corrupt, inconsistent state.

**Action:** Tell the user: "The MCP server appears to be connected to the wrong database. Please restart your Claude session to reconnect, then we can resume."

---

## When to Invoke

**Create operations:**

- User mentions: "create milestone", "new milestone", "add milestone"
- User describes time-bounded goal: "by end of Q1", "release in 2 weeks", "sprint goal"
- User wants to group issues: "group these issues together", "plan a release"

**Update operations:**

- User mentions: "update milestone M1", "change milestone", "extend deadline"
- User wants to modify: "push back the due date", "rename milestone"
- User references milestone: "M3 needs to include...", "milestone 2 is complete"

**Assignment operations:**

- User wants to assign: "add issue #5 to M1", "include #3 in the milestone"
- User wants to unassign: "remove issue #2 from milestone", "unassign from M1"
- User mentions milestone in issue context: "create issue for M2", "this is part of milestone 1"

## Milestone Concepts

### What is a Milestone?

A milestone is a **time-bounded goal** that groups related issues:

- Has a **start date** and **end date**
- Has a **status**: PLANNED, IN_PROGRESS, COMPLETED, DELAYED
- Contains **zero or more issues**
- Displayed on a **timeline view**

### Milestone Numbering

Milestones are numbered sequentially per project: M1, M2, M3, etc.

### Status Meanings

| Status          | Meaning                                         |
| --------------- | ----------------------------------------------- |
| **PLANNED**     | Future milestone, not yet started               |
| **IN_PROGRESS** | Currently active, work is ongoing               |
| **COMPLETED**   | All work finished, goal achieved                |
| **DELAYED**     | Behind schedule, past end date but not complete |

## Process

### For Creating Milestones

1. **Gather milestone information:**
   - Title: What is the goal? (e.g., "MVP Release", "Auth Feature Complete")
   - Description: What does this milestone encompass?
   - Start date: When does work begin? (YYYY-MM-DD format)
   - End date: When should it be complete? (YYYY-MM-DD format)
   - Status: Usually starts as PLANNED

2. **Validate dates:**
   - Start date must be before or equal to end date
   - Use ISO format: YYYY-MM-DD
   - If user gives relative dates ("next week"), convert to absolute dates

3. **Create milestone:**
   - Call `create_milestone` with the gathered information
   - Note the milestone number (M1, M2, etc.)

4. **Assign issues (optional):**
   - If user mentioned specific issues to include, assign them
   - Call `assign_issue_to_milestone` for each issue
   - Or guide user to assign issues later

### For Updating Milestones

1. **Get current milestone:**
   - Call `get_milestone` with the milestone number
   - Show current state including assigned issues

2. **Determine changes:**
   - Title, description, dates, or status
   - Confirm changes if ambiguous

3. **Update milestone:**
   - Call `update_milestone` with the changes

4. **Report:**
   - Show what was changed
   - Show updated issue assignments if relevant

### For Assigning Issues to Milestones

1. **Verify both exist:**
   - Call `get_issue` to verify issue exists
   - Call `get_milestone` to verify milestone exists

2. **Assign the issue:**
   - Call `assign_issue_to_milestone` with both issueNumber and milestoneNumber

3. **Report:**
   - Confirm the assignment
   - Show current milestone progress

### For Removing Issues from Milestones

1. **Verify issue exists:**
   - Call `get_issue` to verify issue exists and is assigned to a milestone

2. **Remove from milestone:**
   - Call `remove_issue_from_milestone` with the issueNumber

3. **Report:**
   - Confirm the removal

### For Listing Milestones

- Use `list_milestones` to show all milestones
- Filter by status if requested (e.g., "show active milestones")
- Shows issue counts and progress for each

## Date Handling

Convert relative dates to absolute ISO format:

- "next week" → calculate actual date
- "end of month" → last day of current month
- "Q1" → appropriate quarter end date
- "2 weeks from now" → calculate date

Always confirm dates with user before creating.

## Integration with Issue Management

When creating issues with the dfl-manage-issue skill, if user mentions a milestone:

- Note the milestone reference
- After issue creation, assign to the milestone
- Report the assignment in the response

## Error Handling

If MCP tool call fails:

- Explain the error clearly
- Common issues:
  - Invalid date format (must be YYYY-MM-DD)
  - Start date after end date
  - Milestone or issue not found
- Suggest corrections

## Example Interactions

### Creating / Assigning / Viewing

**Create:** "Create milestone for Q1 release, Jan 1 - Mar 31"

```
Created M1: Q1 Release (2025-01-01 to 2025-03-31, PLANNED)
```

**Assign:** "Add issues #1, #3, #5 to M1"

```
Assigned to M1. Progress: 0/3 completed
```

**View:** "Show M1"

```
M1: Q1 Release | IN_PROGRESS | 2025-01-01 to 2025-03-31
Issues: #1 (IN_PROGRESS), #3 (OPEN), #5 (COMPLETED)
Progress: 1/3 completed
```

**Update status:** "Mark M1 completed" → Status: PLANNED → COMPLETED

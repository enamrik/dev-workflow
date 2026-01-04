---
name: dwf-manage-milestone
description: Manage milestones - time-bounded goals that group related issues. Use for creating, updating, and organizing issues into milestones for project planning.
allowed-tools: mcp:dev-workflow-tracker:create_milestone, mcp:dev-workflow-tracker:get_milestone, mcp:dev-workflow-tracker:list_milestones, mcp:dev-workflow-tracker:update_milestone, mcp:dev-workflow-tracker:delete_milestone, mcp:dev-workflow-tracker:assign_issue_to_milestone, mcp:dev-workflow-tracker:search_issues
---

# Manage Milestone Skill

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

2. **Assign or unassign:**
   - Call `assign_issue_to_milestone`
   - Include milestoneNumber to assign
   - Omit milestoneNumber to unassign

3. **Report:**
   - Confirm the assignment
   - Show current milestone progress

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

When creating issues with the dwf-manage-issue skill, if user mentions a milestone:

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

### Creating a Milestone

**User:** "Create a milestone for our Q1 release, starting January 1st and ending March 31st"

**Response:**

```
Created milestone M1: Q1 Release
  Start: 2025-01-01
  End: 2025-03-31
  Status: PLANNED

Would you like to assign any existing issues to this milestone?
```

### Assigning Issues to a Milestone

**User:** "Add issues #1, #3, and #5 to M1"

**Response:**

```
Assigned issues to milestone M1:
  - #1: Add user authentication
  - #3: Implement login page
  - #5: Add password reset

M1 Progress: 0/3 issues completed (3 open)
```

### Viewing Milestone Status

**User:** "Show me milestone M1"

**Response:**

```
Milestone M1: Q1 Release
  Status: IN_PROGRESS
  Dates: 2025-01-01 to 2025-03-31

Issues (3 total):
  - #1: Add user authentication (IN_PROGRESS)
  - #3: Implement login page (OPEN)
  - #5: Add password reset (COMPLETED)

Progress: 1/3 completed
```

### Updating Milestone Status

**User:** "Mark M1 as completed"

**Response:**

```
Updated milestone M1:
  Status: PLANNED → COMPLETED

All 3 issues in this milestone are now tracked as part of the completed goal.
```

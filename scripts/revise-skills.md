# Skill Revision Guide

When revising Claude Code skills, the focus must be on **what Claude needs to do the job correctly** - not on mechanical condensing.

## Core Principle

**Think as the one who will use these instructions.** Ask: "What do I need to understand this workflow and execute it correctly?"

## What to Keep

### Step-by-Step Instructions

Process sections that tell Claude exactly what to do. These are referenced constantly during work.

```
✅ Keep: "1. Check task status 2. Call load_task_session 3. Present to user"
```

### Critical Warnings

Sections that prevent mistakes, data corruption, or wrong behavior. If skipping this instruction would cause problems, keep it.

```
✅ Keep: "NEVER fall back to main repo path - it may be on a different branch"
✅ Keep: "STOP IMMEDIATELY if MCP tools return unexpected errors"
```

### Reference Tables

Quick lookups for state machines, error handling, status transitions. Claude uses these during work.

```
✅ Keep: Status transition tables, error → action mappings
```

### Trigger Phrases for Skill Matching

Natural language phrases that help Claude Code match the skill to user requests.

```
✅ Keep: "start task", "work on task", "I'm ready to implement", "let's begin"
```

### One Example Per Pattern

Examples that show the expected output format and tone. One example is enough to understand a pattern.

## What to Remove

### Duplicate Explanations

If the same concept is explained in two places, keep the better one and remove or reference the other.

```
❌ Remove: "Execution Mode Details" section that repeats earlier "Execution Modes" summary
✅ Do: Keep one explanation, reference it elsewhere: "same as step 4 above"
```

### Multiple Examples Showing Same Pattern

If 3 examples all demonstrate the same concept, one is enough.

```
❌ Remove: 3 force mode examples all showing "error → explain → confirm → retry with force"
✅ Do: Keep 1 example that shows the pattern clearly
```

### Verbose Prose That Can Be a Table

Lists of errors with multi-line explanations can usually become a table.

```
❌ Remove:
**Create PR failed - wrong status:**
- Task is not IN_PROGRESS (e.g., already in PR_REVIEW or COMPLETED)
- If the task state has drifted → offer to use force mode

✅ Do:
| Error | Action |
|-------|--------|
| Create PR failed - wrong status | Force mode if state drifted |
```

### Explanatory Text When Instructions Suffice

"Why" explanations can often be trimmed if the "what" is clear.

```
❌ Remove: Long explanation of why rebasing is important
✅ Keep: "Rebase on main and re-run validation" (the instruction itself)
```

## How to Approach a Revision

1. **Read the entire skill first** - understand what it teaches

2. **Identify the Process sections** - these are usually essential, don't touch unless clearly redundant

3. **Look for duplicates** - same info explained twice? Keep the better one

4. **Count examples per concept** - more than 2 showing the same pattern? Condense to 1

5. **Check for reference material** - tables, diagrams, lists I'd look up during work? Keep them

6. **Verify trigger phrases are intact** - these affect skill matching

7. **Read the result as Claude would** - "Can I do the job with these instructions?"

## Line Count vs. Usefulness

**Don't sacrifice instructions to hit a line count.**

If you've removed genuinely redundant content and the skill is still longer than the target, that's okay. A 600-line skill that has everything Claude needs is better than a 500-line skill that's missing a critical step.

The goal is: **Remove redundancy, keep instructions.**

## Checklist Before Committing

- [ ] All process/workflow instructions are intact
- [ ] Critical warnings are preserved
- [ ] At least one example per operation type remains
- [ ] Reference tables (status transitions, errors) are present
- [ ] Trigger phrases for skill matching are unchanged
- [ ] Read through as Claude - can I do the job?

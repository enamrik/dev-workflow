---
name: create-issue
description: Create a new issue in the task tracker. Auto-invoked when user wants to "create issue", "new feature", "report bug", "add task", etc.
allowed-tools: mcp:dev-workflow-tracker:create_issue, mcp:dev-workflow-tracker:list_templates
---

# Create Issue Skill

## When to Invoke
- User mentions: "create issue", "new feature", "report bug", "add enhancement", "add task"
- User describes work: "I want to add authentication", "There's a bug in the login"
- User requests tracking: "track this", "make an issue for this"

## Process

1. **Analyze user intent:**
   - Extract: title, description, type (feature/bug/enhancement/task)
   - Determine if template should be used

2. **Gather information:**
   - If user provided full description → proceed
   - If missing details → ask clarifying questions:
     - "What's the title for this issue?"
     - "Can you describe it in more detail?"
     - "What are the acceptance criteria?"

3. **Select template (optional):**
   - Call `list_templates` to see available templates
   - Auto-select based on issue type:
     - Keywords "bug", "error", "broken", "failing" → bug.md
     - Keywords "feature", "add", "implement", "new" → feature.md
     - Keywords "improve", "optimize", "enhance", "better" → enhancement.md
     - Default → feature.md
   - Templates are flexible - adapt as needed

4. **Create issue:**
   - Call `create_issue` MCP tool with gathered information
   - Use template if appropriate (useTemplate: true)
   - Provide all available details

5. **Report results:**
   - Show issue number (#123)
   - Show issue URL (if available)
   - Summarize what was created
   - Suggest next steps

## Example Interaction

**User:** "I want to add user authentication with OAuth"

**Skill Response:**
```
✓ Creating issue for new feature...

Issue created: **#1 - Add user authentication with OAuth**
  Type: FEATURE
  Priority: MEDIUM
  Template: feature.md

  View: http://localhost:3000/issues/1

  Acceptance Criteria:
  - [ ] OAuth integration with Google
  - [ ] OAuth integration with GitHub
  - [ ] User session management
  - [ ] Secure token storage

Next steps: This issue is now ready for planning!
```

## Advanced

### Priority Extraction
If user mentions specific priority/urgency:
- "high priority bug", "critical issue" → priority: HIGH or CRITICAL
- "urgent feature", "asap" → priority: CRITICAL
- "low priority", "nice to have" → priority: LOW
- Extract and apply automatically

### Label Extraction
If user mentions categories or tags:
- "authentication feature" → labels: ["authentication", "feature"]
- "UI bug" → labels: ["ui", "bug"]
- Extract relevant labels from description

### Template Fallback
If template is not found or doesn't match:
- Generate custom format based on description
- Use common fields: title, description, acceptance criteria
- Adapt to user's natural language

## Error Handling

If MCP tool call fails:
- Explain the error clearly
- Suggest troubleshooting steps:
  - Is dev-workflow initialized? (run `dev-workflow init`)
  - Is the MCP server running?
  - Check `.claude/config/mcp-servers.json`
- Offer to help diagnose the issue

## Notes

- Templates are suggestions, not strict schemas
- Claude should adapt the format if the template doesn't fit
- Always confirm successful creation with issue number
- Provide actionable next steps after creation

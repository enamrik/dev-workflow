---
name: dwf-configure-github
description: Configure GitHub integration for issue syncing. Use this when user wants to enable/disable GitHub sync, set up GitHub Projects integration, or configure issue labels.
allowed-tools: mcp:dev-workflow-tracker:update_settings
---

# Configure GitHub Skill

## When to Invoke

**Enable GitHub sync:**
- User mentions: "enable GitHub", "set up GitHub sync", "connect to GitHub"
- User wants syncing: "sync issues to GitHub", "push issues to GitHub"
- User references repo: "link this to my GitHub repo"

**Configure GitHub Projects:**
- User mentions: "add to project board", "GitHub Projects", "project ID"
- User wants project integration: "add issues to my project"

**Configure labels:**
- User mentions: "GitHub labels", "configure labels", "change label mapping"
- User wants custom labels: "add label to all issues"

**Disable GitHub:**
- User mentions: "disable GitHub", "turn off sync", "disconnect GitHub"

**Check status:**
- User asks: "is GitHub enabled?", "GitHub status", "check GitHub config"

## Prerequisites

Before enabling GitHub sync, the following must be true:
1. **gh CLI installed** - User must have GitHub CLI installed
2. **gh CLI authenticated** - User must have run `gh auth login`
3. **Repository access** - User must have access to the target repository

## Process

### For Enabling GitHub Sync

1. **Check current status first:**
   - Call `update_settings` with `action: "get_settings"`
   - If already enabled, inform user and ask if they want to reconfigure

2. **Verify gh CLI is authenticated:**
   - The `get_settings` response includes `githubCLI.authenticated`
   - If NOT authenticated, stop and guide user:
     ```
     GitHub CLI is not authenticated. Please run:

       gh auth login

     Then try again.
     ```

3. **Gather required information:**
   - If user provided owner/repo → proceed
   - If not provided → ask:
     - "What GitHub repository should issues sync to?"
     - "Format: owner/repo (e.g., myorg/myproject)"

4. **Ask about optional features:**
   - "Do you want to add issues to a GitHub Project? If so, what's the Project ID?"
   - Project IDs look like: `PVT_kwDOABC123...`
   - If user doesn't know → explain how to find it in GitHub Project settings

5. **Ask about label configuration:**
   - Default labels are: feature, bug, enhancement, task
   - Ask: "Do you want custom labels for issue types, or use the defaults?"
   - If custom → gather the mapping

6. **Enable with validation:**
   - Call `update_settings` with:
     ```json
     {
       "action": "enable_github",
       "github": {
         "owner": "<owner>",
         "repo": "<repo>",
         "projectId": "<optional>",
         "labels": { ... }
       }
     }
     ```

7. **Report result:**
   - Success: Show what was configured
   - Note: "MCP server restart may be required for sync to take effect"
   - If validation failed: Explain the specific error

### For Disabling GitHub Sync

1. **Confirm with user:**
   - "This will stop syncing issues to GitHub. Existing issues will remain on GitHub. Continue?"

2. **Disable:**
   - Call `update_settings` with `action: "disable_github"`

3. **Report:**
   - "GitHub sync has been disabled. Local issues will no longer sync to GitHub."

### For Configuring (Labels/ProjectId)

1. **Check GitHub is enabled:**
   - Call `update_settings` with `action: "get_settings"`
   - If NOT enabled → suggest enabling first

2. **Gather changes:**
   - What does user want to change? (labels, projectId)

3. **Update configuration:**
   - Call `update_settings` with `action: "configure_github"`
   - Only include fields being changed

### For Checking Status

1. **Get current settings:**
   - Call `update_settings` with `action: "get_settings"`

2. **Report clearly:**
   ```
   GitHub Integration Status:
   - Enabled: Yes/No
   - Repository: owner/repo
   - Project ID: PVT_xxx (or "not configured")
   - Labels: feature→feature, bug→bug, ...
   - gh CLI authenticated: Yes/No
   ```

## Error Handling

| Error | User Guidance |
|-------|---------------|
| "gh is not authenticated" | Run `gh auth login` first |
| "Repository not found" | Check owner/repo spelling and access permissions |
| "Project not found" | Verify Project ID in GitHub Project settings → ... → Copy ID |
| "Config not found" | Run `dev-workflow init` first |

## Finding GitHub Project ID

If user needs help finding their Project ID:

```
To find your GitHub Project ID:
1. Go to your GitHub Project
2. Click the ⋯ menu (top right)
3. Select "Copy link" or go to Settings
4. The URL contains the project number
5. Or use: gh project list --owner <owner> --format json
```

## Example Interactions

### Enable GitHub Sync

**User:** "I want to sync issues to GitHub"

**Response:**
```
I'll help you set up GitHub sync. Let me first check if the gh CLI is authenticated.

[Calls get_settings]

Great, gh CLI is authenticated. What GitHub repository should issues sync to?
Please provide in the format: owner/repo (e.g., myorg/myproject)
```

**User:** "anthropics/claude-code"

**Response:**
```
Got it. A couple more questions:

1. Do you want issues added to a GitHub Project board?
   If yes, please provide the Project ID (looks like PVT_kwDO...)
   If no, just say "no project"

2. Should I use the default label mapping?
   - FEATURE → "feature"
   - BUG → "bug"
   - ENHANCEMENT → "enhancement"
   - TASK → "task"
```

**User:** "No project, default labels are fine"

**Response:**
```
[Calls enable_github with owner/repo]

GitHub sync enabled for anthropics/claude-code

Configuration:
- Issues will sync to: anthropics/claude-code
- GitHub Project: Not configured
- Labels: Using defaults (feature, bug, enhancement, task)

Note: You may need to restart the MCP server for sync to take effect.
When you create issues, they'll automatically appear on GitHub.
```

### Check Status

**User:** "Is GitHub sync enabled?"

**Response:**
```
[Calls get_settings]

GitHub Integration Status:
- Enabled: Yes
- Repository: anthropics/claude-code
- Project ID: Not configured
- Label mapping:
  - FEATURE → feature
  - BUG → bug
  - ENHANCEMENT → enhancement
  - TASK → task
- gh CLI: Authenticated
```

### gh Not Authenticated

**User:** "Enable GitHub sync for myorg/myrepo"

**Response:**
```
[Calls get_settings, sees githubCLI.authenticated = false]

I can't enable GitHub sync yet because the gh CLI is not authenticated.

Please run this command first:

  gh auth login

Follow the prompts to authenticate, then try again.
```

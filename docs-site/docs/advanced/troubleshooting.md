---
sidebar_position: 3
---

# Troubleshooting

Solutions to common dev-workflow issues.

## MCP Server Issues

### "Tool not found" or "Server not connected"

**Symptoms:**

- Claude says MCP tools aren't available
- Tools return "unknown tool" errors

**Solutions:**

1. Check MCP registration:

   ```bash
   cat ~/.claude.json | grep dev-workflow
   ```

2. Re-register:

   ```bash
   dwf init
   ```

3. Restart Claude Code session

### "Database not found" or Wrong Data

**Symptoms:**

- Tools return "issue not found" for existing issues
- Data appears to be from different project

**Cause:** MCP server connected to wrong database

**Solution:**

1. **Stop immediately** - Don't try to work around it
2. Restart Claude Code session
3. Verify correct project directory

### MCP Server Won't Start

**Symptoms:**

- `dwf mcp` fails
- Error in Claude Code when using tools

**Solutions:**

1. Check Node.js version:

   ```bash
   node --version  # Must be >= 20
   ```

2. Rebuild if needed:

   ```bash
   cd /path/to/dev-workflow
   pnpm install
   pnpm build
   ```

3. Check for port conflicts

## Database Issues

### Migration Errors

**Symptoms:**

- Errors about missing columns
- "no such column" errors

**Solution:**

```bash
dwf update
```

### Corrupt Database

**Symptoms:**

- SQLite errors
- "database is malformed"

**Solution:**

```bash
# Backup current database
cp ~/.dwf/track/workflow.db ~/.dwf/track/workflow.db.backup

# Try to recover
sqlite3 ~/.dwf/track/workflow.db ".recover" | sqlite3 ~/.dwf/track/workflow.recovered.db

# Or restore from backup if you have one
```

### Database Locked

**Symptoms:**

- "database is locked" errors
- Operations time out

**Cause:** Multiple processes accessing database

**Solution:**

1. Close other dev-workflow processes
2. Stop web UI if running
3. Kill stale MCP servers:
   ```bash
   pkill -f "dev-workflow.*mcp"
   ```

## Git/Worktree Issues

### Worktree Creation Fails

**Symptoms:**

- `load_task_session` fails
- "worktree already exists" errors

**Solutions:**

1. List existing worktrees:

   ```bash
   git worktree list
   ```

2. Prune stale worktrees:

   ```typescript
   prune_stale_worktrees({});
   ```

3. Manually remove if needed:
   ```bash
   git worktree remove /path/to/worktree --force
   ```

### Branch Already Exists

**Symptoms:**

- PR creation fails
- "branch already exists" errors

**Solution:**

```bash
# Check for existing branch
git branch -a | grep issue-N

# Delete if stale
git branch -D issue-N/task-M-slug
git push origin --delete issue-N/task-M-slug
```

### Worktree Path Not Found

**Symptoms:**

- File operations fail
- "directory not found" errors

**Cause:** Using main repo path instead of worktree path

**Solution:**
Use the path returned by `load_task_session`, not the original repo path.

## GitHub Integration Issues

### "gh CLI not authenticated"

**Solution:**

```bash
gh auth login
```

### "Not in a GitHub repository"

**Solutions:**

1. Verify GitHub remote:

   ```bash
   git remote -v
   ```

2. Add remote if missing:
   ```bash
   git remote add origin https://github.com/owner/repo.git
   ```

### Tasks Not Syncing to GitHub

**Check:**

1. GitHub sync enabled:

   ```typescript
   update_settings({ action: "get_settings" });
   ```

2. Repair sync:
   ```typescript
   sync_issue({ issueNumber: N });
   ```

### Project Board Not Updating

**Solutions:**

1. Verify project ID:

   ```typescript
   update_settings({ action: "get_settings" });
   ```

2. Check column mapping:

   ```typescript
   update_settings({
     action: "configure_column_mapping",
     github: {
       columnMapping: {
         READY: "Your Column Name",
       },
     },
   });
   ```

3. Verify project access in GitHub

## Task Execution Issues

### Task Locked by Another Session

**Symptoms:**

- "task in progress by another session"

**Solutions:**

1. Wait for session timeout (1 hour)
2. Force claim if session is stale:
   ```typescript
   load_task_session({
     taskId: "...",
     sessionId: "new-session",
     force: true,
   });
   ```

### Can't Complete Task - Wrong Status

**Symptoms:**

- "Task must be in PR_REVIEW to complete"

**Cause:** State drift - PR merged outside normal flow

**Solution:**

```typescript
complete_task({
  taskId: "...",
  sessionId: "...",
  finalLogEntry: "...",
  force: true, // After user confirmation
});
```

### PR Not Found

**Symptoms:**

- `submit_for_review` fails
- "no PR for this task"

**Cause:** `create_pr` wasn't called

**Solution:**

```typescript
create_pr({ taskId: "..." });
```

## Web UI Issues

### Port Already in Use

**Solution:**

```bash
# Find process
lsof -i :3000

# Use different port
PORT=3001 dwf ui
```

### No Projects Showing

**Solutions:**

1. Run `dwf init` in at least one project
2. Check database exists: `ls ~/.dwf/track/workflow.db`
3. Verify track directory: `echo $DWF_HOME`

### Stale Data

**Solution:**

- Hard refresh: Ctrl+Shift+R / Cmd+Shift+R
- Restart web UI

## Worker Issues

### Worker Not Claiming Tasks

**Check:**

1. Worker is running: `dwf workers`
2. Tasks are in queue: `get_dispatch_status()`
3. Tasks are READY status

### Worker Stuck

**Solutions:**

1. Check Claude session output for errors
2. Check MCP server connection
3. Force-abandon stuck task:
   ```typescript
   abandon_task({
     taskId: "...",
     sessionId: "...",
     reason: "Worker stuck",
     force: true,
   });
   ```

## Performance Issues

### Slow Tool Responses

**Solutions:**

1. Check database size
2. Run VACUUM:
   ```bash
   sqlite3 ~/.dwf/track/workflow.db "VACUUM;"
   ```
3. Check for long-running queries

### High Memory Usage

**Solutions:**

1. Reduce number of workers
2. Close unused Claude sessions
3. Restart MCP server:
   ```bash
   pkill -f "dev-workflow.*mcp"
   ```

## Getting Help

### Debug Information

Collect before reporting issues:

```bash
# Version
dwf --version

# Node version
node --version

# Database status
ls -la ~/.dwf/track/

# MCP registration
cat ~/.claude.json

# Git status
git status
```

### Reporting Issues

File issues at: https://github.com/your-org/dev-workflow/issues

Include:

- Steps to reproduce
- Expected vs actual behavior
- Debug information above
- Relevant error messages

## Next Steps

- [Architecture Overview](/advanced/architecture)
- [Contributing Guide](/advanced/contributing)

# Troubleshooting

> This guide is part of the [dev-workflow documentation](../README.md).

Common issues and solutions for dev-workflow. If you encounter a problem not covered here, please [open an issue](https://github.com/enamrik/dev-workflow/issues).

## MCP Server Connection Issues

### "MCP tool not found" or "No MCP tools available"

**Symptoms:**

- Claude Code can't find dev-workflow tools
- Tools like `create_issue` aren't recognized

**Solutions:**

1. **Verify MCP server is configured in Claude Code:**

   ```bash
   # Check claude_code_config.json
   cat ~/.config/claude-code/claude_code_config.json
   ```

   Should contain:

   ```json
   {
     "mcpServers": {
       "dev-workflow": {
         "command": "dev-workflow",
         "args": ["mcp"]
       }
     }
   }
   ```

2. **Restart the MCP server:**

   ```bash
   # Kill existing server
   pkill -f "dev-workflow.*mcp"

   # Or in Claude Code, run /mcp to restart
   ```

3. **Re-run dev-workflow init:**
   ```bash
   dev-workflow init
   ```

### "Issue not found" or "Task not found" for existing data

**Symptoms:**

- Tools return "not found" for data that should exist
- Sudden loss of access to issues or tasks

**Cause:**
The MCP server may be connected to the wrong database (common after switching between projects or worktrees).

**Solution:**

1. **Do NOT try to work around manually** - this creates inconsistent state
2. **Restart your Claude session** to reconnect the MCP server
3. **Resume your task** after restart:
   ```
   load_task_session
     taskId: "<your-task-id>"
     sessionId: "<your-session-id>"
   ```
4. **Check execution log** for previous progress:
   ```
   get_task_execution_log
     taskId: "<your-task-id>"
   ```

### Session UUID Mismatch

**Symptoms:**

- "Task is owned by another session"
- Can't continue work on a task you were working on

**Cause:**
Session IDs are generated per Claude session. If you restart Claude, the new session has a different ID.

**Solutions:**

1. **For stale sessions** (previous session died), use force mode:

   ```
   load_task_session
     taskId: "<task-id>"
     sessionId: "<new-session-id>"
     force: true  # Only with user confirmation
   ```

2. **For genuinely active sessions**, wait for the other session to complete

## GitHub Authentication Issues

### "GitHub CLI (gh) is not authenticated"

**Symptoms:**

- `enable_github` fails with auth error
- GitHub sync doesn't work

**Solutions:**

1. **Authenticate gh CLI:**

   ```bash
   gh auth login
   ```

2. **Verify authentication:**

   ```bash
   gh auth status
   ```

3. **Check scopes** - ensure you have `repo` and `project` scopes

### "Not in a GitHub repository"

**Symptoms:**

- `enable_github` fails even though you're in a git repo

**Solutions:**

1. **Verify remote exists:**

   ```bash
   git remote -v
   ```

2. **Add GitHub remote if missing:**

   ```bash
   git remote add origin git@github.com:owner/repo.git
   ```

3. **Ensure the remote is GitHub** (not GitLab, Bitbucket, etc.)

### "GitHub Project not found"

**Symptoms:**

- Project ID is rejected when enabling GitHub sync

**Solutions:**

1. **Verify project ID format:**
   - Must be `PVT_` followed by alphanumeric string
   - Get from: GitHub Project → Settings → General → copy "Project node ID"

2. **Check project access:**
   - Your GitHub account must have access to the project
   - For organization projects, check organization permissions

### GitHub sync not updating project board

**Symptoms:**

- Issues/tasks created in GitHub but not appearing on project board
- Status column not updating

**Solutions:**

1. **Verify project ID is configured:**

   ```
   update_settings
     action: "get_settings"
   ```

2. **Check column mapping:**

   ```
   update_settings
     action: "configure_column_mapping"
   ```

3. **Repair sync state:**
   ```
   sync_issue
     issueNumber: <number>
   ```

## Worktree Issues

### "Worktree already exists"

**Symptoms:**

- `load_task_session` fails when starting a task
- Error mentions existing worktree

**Solutions:**

1. **List worktrees:**

   ```
   list_worktrees
   ```

2. **Prune stale worktrees:**

   ```
   prune_stale_worktrees
   ```

3. **Manually remove if needed:**
   ```bash
   git worktree remove /path/to/worktree --force
   ```

### Orphaned worktrees

**Symptoms:**

- Web UI shows worktrees with "no linked task"
- Disk space not reclaimed

**Solutions:**

1. **View in Web UI:** `/worktrees` page shows orphaned count

2. **Prune via MCP:**

   ```
   prune_stale_worktrees
   ```

3. **Manual cleanup:**
   ```bash
   git worktree prune
   ```

### Worktree has uncommitted changes

**Symptoms:**

- Can't complete task or switch worktrees
- Git operations fail

**Solution:**
In the worktree directory:

```bash
git stash  # Save changes
# or
git add . && git commit -m "WIP"
```

## Database Issues

### "Database is locked"

**Symptoms:**

- Multiple Claude sessions or UI fail with lock errors
- Operations hang or timeout

**Solutions:**

1. **Check for long-running processes:**

   ```bash
   lsof ~/.track/workflow.db
   ```

2. **Kill stuck processes if safe:**

   ```bash
   pkill -f "dev-workflow"
   ```

3. **Restart Claude session**

### Database migration errors

**Symptoms:**

- "Migration failed" on startup
- Schema mismatch errors

**Solutions:**

1. **Run update command:**

   ```bash
   dev-workflow update
   ```

2. **If migration is stuck**, check for pending migrations:

   ```bash
   cd packages/core
   pnpm drizzle-kit generate
   ```

3. **Never delete `~/.track/workflow.db`** - this contains all your data

### Data not showing after restart

**Symptoms:**

- Issues/tasks missing after restarting Claude
- Empty project

**Cause:**
Usually a path or project mismatch.

**Solutions:**

1. **Verify you're in the right directory:**

   ```bash
   pwd
   git rev-parse --show-toplevel
   ```

2. **Check project ID:**

   ```
   update_settings
     action: "get_settings"
   ```

3. **List all projects in database:**
   - Check the Web UI at `/` - project selector shows all discovered projects

## Task Execution Issues

### Task stuck in IN_PROGRESS

**Symptoms:**

- Task shows IN_PROGRESS but no active work
- Can't start a new task

**Solutions:**

1. **Resume the task:**

   ```
   load_task_session
     taskId: "<task-id>"
     sessionId: "<session-id>"
   ```

   This is idempotent - if the task is already IN_PROGRESS, it resumes.

2. **Abandon if truly stuck:**
   ```
   abandon_task
     taskId: "<task-id>"
     sessionId: "<session-id>"
     reason: "Session died unexpectedly"
     force: true  # If ownership check fails
   ```

### PR not detected as merged

**Symptoms:**

- `complete_task` fails saying PR is not merged
- PR shows as merged on GitHub

**Solutions:**

1. **Refresh PR status:**

   ```
   get_task_pr_status
     taskId: "<task-id>"
   ```

2. **Force complete if PR is actually merged:**
   ```
   complete_task
     taskId: "<task-id>"
     sessionId: "<session-id>"
     finalLogEntry: "PR confirmed merged manually"
     force: true
   ```

### Dependencies preventing task start

**Symptoms:**

- Task shows BACKLOG but won't transition to READY
- "Waiting on dependencies"

**Solution:**
Check and complete dependent tasks first:

```
get_task
  taskId: "<task-id>"
```

The `dependsOn` field shows which tasks must complete first.

## Worker Issues

### Worker marked as dead

**Symptoms:**

- Worker shows DEAD in Web UI
- Tasks stuck in dispatch queue

**Cause:**
Worker process died without calling `end_worker_session`.

**Solutions:**

1. **Tasks will show as STALE** in dispatch queue
2. **Reclaim the task** from a new session:
   ```
   load_task_session
     taskId: "<task-id>"
     sessionId: "<new-session-id>"
     force: true
   ```

### Dispatch queue not draining

**Symptoms:**

- Tasks stuck in UNCLAIMED
- No workers picking up tasks

**Solutions:**

1. **Check worker status:**

   ```
   get_dispatch_status
   ```

2. **Verify workers are running:**

   ```bash
   dev-workflow worker
   ```

3. **Manually work the task** without workers:
   ```
   load_task_session
     taskId: "<task-id>"
     sessionId: "<session-id>"
   ```

## Common Error Messages

| Error                                      | Meaning                                                 | Solution                                                          |
| ------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| "Task numbers are immutable after PLANNED" | Can't delete/reorder tasks after issue moved to BACKLOG | Use `abandon_task` instead                                        |
| "Cannot modify default template"           | Trying to edit a built-in template                      | Create a local template with same name to override                |
| "Issue is already closed"                  | Calling `close_issue` on closed issue                   | No action needed - issue is already in desired state              |
| "startDate must be before endDate"         | Invalid milestone date range                            | Swap the dates or adjust range                                    |
| "Status can only be set to COMPLETED"      | Trying to manually set computed milestone status        | Let status compute automatically, only set COMPLETED for sign-off |

## Getting Help

1. **Check the documentation:**
   - [Quick Start](QUICK_START.md)
   - [MCP Tools Reference](MCP_TOOLS.md)
   - [Task Execution Guide](TASK_EXECUTION.md)

2. **Review ADRs** for design rationale:
   - [ADR 001: Dual-Mode Task Execution](adr/001-dual-mode-task-execution.md)
   - [ADR 002: Hook Composition](adr/002-hook-composition.md)
   - [ADR 003: Snapshot Versioning](adr/003-snapshot-versioning.md)

3. **Report issues:**
   - [GitHub Issues](https://github.com/enamrik/dev-workflow/issues)
   - Include: error message, reproduction steps, and relevant context

## Diagnostic Commands

Useful commands for debugging:

```bash
# Check dev-workflow version
dev-workflow --version

# Verify MCP server
dev-workflow mcp --help

# Check database location
echo $TRACK_DIR  # If set
ls ~/.track/workflow.db

# List all git worktrees
git worktree list

# Check GitHub CLI status
gh auth status
gh api user

# View recent MCP server logs
# (if running with debug output)
```

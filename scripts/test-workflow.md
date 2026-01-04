# GitHub Sync Test Workflow

This is a runnable test script to verify the GitHub sync workflow is working correctly.
Execute each section in order and verify the expected results.

## Prerequisites

Before running this test:
1. Ensure MCP server is running with latest code: `/mcp`
2. Ensure `gh` CLI is authenticated: `gh auth status`

## Test Configuration

```bash
# Project IDs (update if needed)
GITHUB_PROJECT_ID="PVT_kwHOAAtNZM4BLyP8"
STATUS_FIELD_ID="PVTSSF_lAHOAAtNZM4BLyP8zg7QWhw"

# Column option IDs
BACKLOG_OPTION_ID="f75ad846"
READY_OPTION_ID="61e4505c"
IN_PROGRESS_OPTION_ID="47fc9ee4"
IN_REVIEW_OPTION_ID="df73e18b"
DONE_OPTION_ID="98236657"
```

---

## Step 1: Create Test Issue

Use MCP tool to create a test issue:

```
Tool: mcp__dev-workflow-tracker__create_issue
Args:
  title: "Sync Test - [timestamp]"
  description: "Testing GitHub sync workflow"
  type: TASK
  priority: LOW
```

**Expected Result**: Issue created with status PLANNED

**Capture**: `ISSUE_NUMBER` from response

---

## Step 2: Generate Plan

```
Tool: mcp__dev-workflow-tracker__generate_plan
Args:
  issueNumber: [ISSUE_NUMBER]
  summary: "Sync test plan"
  approach: "Create test file to verify sync"
  estimatedComplexity: LOW
  tasks: [{"id": "test", "title": "Create test file", "description": "Test file for sync verification"}]
```

**Expected Result**: Plan created with 1 task in PLANNED status

**Capture**: `TASK_ID` from response

---

## Step 3: Move to Backlog

This activates the issue and creates GitHub issues for tasks.

```
Tool: mcp__dev-workflow-tracker__move_issue_to_backlog
Args:
  issueNumber: [ISSUE_NUMBER]
```

**Expected Result**:
- Issue status: OPEN
- Task status: BACKLOG
- GitHub issue created

**Capture**: `GITHUB_ISSUE_NUMBER` from response

### Verify: GitHub Issue Created

```bash
gh api graphql -f query='
query {
  repository(owner: "enamrik", name: "dev-workflow") {
    issue(number: [GITHUB_ISSUE_NUMBER]) {
      number
      state
      title
      projectItems(first: 5) {
        nodes {
          id
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}'
```

**Expected**: state=OPEN, projectItems.Status="Backlog"

**Capture**: `PROJECT_ITEM_ID` from projectItems.nodes[0].id

### Verify: Local Database State

```bash
sqlite3 ~/.track/workflow.db "SELECT status, github_issue_number, github_project_item_id, github_sync_status FROM tasks WHERE id = '[TASK_ID]'"
```

**Expected**: BACKLOG | [GITHUB_ISSUE_NUMBER] | [PROJECT_ITEM_ID] | SYNCED

---

## Step 4: Start Task (Isolated Mode)

```
Tool: mcp__dev-workflow-tracker__load_task_session
Args:
  taskId: [TASK_ID]
  sessionId: "sync-test-session"
  mode: "isolated"
```

**Expected Result**:
- Task status: IN_PROGRESS
- Worktree created
- Branch created

**Capture**: `WORKTREE_PATH` and `BRANCH_NAME` from response

### Verify: GitHub Project Column Updated

```bash
gh api graphql -f query='
query {
  repository(owner: "enamrik", name: "dev-workflow") {
    issue(number: [GITHUB_ISSUE_NUMBER]) {
      projectItems(first: 5) {
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}'
```

**Expected**: Status="In progress"

### Verify: Local Database State

```bash
sqlite3 ~/.track/workflow.db "SELECT status, github_sync_status, github_last_sync_error FROM tasks WHERE id = '[TASK_ID]'"
```

**Expected**: IN_PROGRESS | SYNCED | (empty)

---

## Step 5: Make a Commit in Worktree

```bash
cd [WORKTREE_PATH]
echo "Sync test file" > sync-test.txt
git add sync-test.txt
git commit -m "Test: sync verification"
```

**Expected**: Commit created successfully

---

## Step 6: Submit for Review

This is the critical test - creates PR and should move GitHub issue to "In review".

```
Tool: mcp__dev-workflow-tracker__submit_for_review
Args:
  taskId: [TASK_ID]
  title: "Sync Test PR"
  body: "Testing GitHub sync workflow"
```

**Expected Result**:
- Task status: PR_REVIEW
- PR created

**Capture**: `PR_NUMBER` from response

### Verify: GitHub Project Column Updated to "In review"

```bash
gh api graphql -f query='
query {
  repository(owner: "enamrik", name: "dev-workflow") {
    issue(number: [GITHUB_ISSUE_NUMBER]) {
      state
      projectItems(first: 5) {
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}'
```

**Expected**: state=OPEN, Status="In review"

**If Status is NOT "In review"**: This indicates the sync bug. See Troubleshooting section.

### Verify: Local Database State

```bash
sqlite3 ~/.track/workflow.db "SELECT status, pr_number, github_sync_status, github_last_sync_error FROM tasks WHERE id = '[TASK_ID]'"
```

**Expected**: PR_REVIEW | [PR_NUMBER] | SYNCED | (empty)

---

## Step 7: Complete Task (Simulated PR Merge)

For full test, merge the PR on GitHub first, then:

```
Tool: mcp__dev-workflow-tracker__complete_task
Args:
  taskId: [TASK_ID]
  sessionId: "sync-test-session"
```

Or to test abandon flow instead:

```
Tool: mcp__dev-workflow-tracker__abandon_task_session
Args:
  taskId: [TASK_ID]
  sessionId: "sync-test-session"
  reason: "Test cleanup"
```

### Verify: GitHub Issue Closed and Moved to Done

```bash
gh api graphql -f query='
query {
  repository(owner: "enamrik", name: "dev-workflow") {
    issue(number: [GITHUB_ISSUE_NUMBER]) {
      state
      projectItems(first: 5) {
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}'
```

**Expected**: state=CLOSED, Status="Done"

---

## Step 8: Cleanup

Delete the test issue (soft delete):

```
Tool: mcp__dev-workflow-tracker__delete_issue
Args:
  issueNumber: [ISSUE_NUMBER]
```

Close the PR if still open:

```bash
gh pr close [PR_NUMBER] --comment "Test cleanup"
```

---

## Troubleshooting

### Sync Not Working (GitHub column not updating)

1. **Check if MCP server has latest code**:
   ```bash
   pnpm --filter @dev-workflow/core build && pnpm --filter @dev-workflow/mcp-server build
   ```
   Then restart MCP server with `/mcp`

2. **Check task sync state in database**:
   ```bash
   sqlite3 ~/.track/workflow.db "SELECT github_sync_status, github_last_sync_error FROM tasks WHERE id = '[TASK_ID]'"
   ```

   If `github_last_sync_error` has a value, that's the problem.

3. **Check project configuration**:
   ```bash
   sqlite3 ~/.track/workflow.db "SELECT github_sync FROM projects WHERE id = 'de15066e-7af0-458e-bf9d-d383110f7d30'"
   ```

   Should have `enabled: true` and `projectId` set.

4. **Manually fix a stuck GitHub issue**:
   ```bash
   # Get the project item ID
   gh api graphql -f query='query { repository(owner: "enamrik", name: "dev-workflow") { issue(number: [GITHUB_ISSUE_NUMBER]) { projectItems(first: 5) { nodes { id } } } } }'

   # Move to correct column (use appropriate option ID)
   gh api graphql -f query='
   mutation {
     updateProjectV2ItemFieldValue(input: {
       projectId: "PVT_kwHOAAtNZM4BLyP8"
       itemId: "[PROJECT_ITEM_ID]"
       fieldId: "PVTSSF_lAHOAAtNZM4BLyP8zg7QWhw"
       value: { singleSelectOptionId: "[OPTION_ID]" }
     }) {
       projectV2Item { id }
     }
   }'
   ```

   Option IDs:
   - Backlog: f75ad846
   - Ready: 61e4505c
   - In progress: 47fc9ee4
   - In review: df73e18b
   - Done: 98236657

### Getting Project Field Information

If you need to discover field/option IDs for a project:

```bash
gh api graphql -f query='
query {
  node(id: "PVT_kwHOAAtNZM4BLyP8") {
    ... on ProjectV2 {
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          options {
            id
            name
          }
        }
      }
    }
  }
}'
```

---

## Test Results Template

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| 1. Create Issue | PLANNED | | |
| 2. Generate Plan | 1 task PLANNED | | |
| 3. Move to Backlog | GitHub issue created, Backlog column | | |
| 4. Start Task | IN_PROGRESS, "In progress" column | | |
| 5. Make Commit | Commit created | | |
| 6. Submit for Review | PR_REVIEW, "In review" column | | |
| 7. Complete/Abandon | COMPLETED/ABANDONED, "Done" column, CLOSED | | |
| 8. Cleanup | Issue deleted | | |

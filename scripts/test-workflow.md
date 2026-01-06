# GitHub Sync Test Workflow

Runnable test script to verify GitHub Projects column sync works correctly.

## Prerequisites

1. MCP server running with latest code: `/mcp`
2. `gh` CLI authenticated: `gh auth status`

## Configuration

```bash
GITHUB_PROJECT_ID="PVT_kwHOAAtNZM4BLyP8"
STATUS_FIELD_ID="PVTSSF_lAHOAAtNZM4BLyP8zg7QWhw"
```

| Column      | Option ID |
| ----------- | --------- |
| Backlog     | f75ad846  |
| Ready       | 61e4505c  |
| In progress | 47fc9ee4  |
| In review   | df73e18b  |
| Done        | 98236657  |

## Verification Query

Use this query throughout testing (replace `[GITHUB_ISSUE_NUMBER]`):

```bash
gh api graphql -f query='query { repository(owner: "enamrik", name: "dev-workflow") { issue(number: [GITHUB_ISSUE_NUMBER]) { state projectItems(first: 1) { nodes { id fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }' --jq '.data.repository.issue | "State: \(.state), Column: \(.projectItems.nodes[0].fieldValueByName.name)"'
```

---

## Step 1: Create Test Issue

```
Tool: create_issue
Args: title: "Sync Test - [timestamp]", description: "Testing GitHub sync", type: TASK, priority: LOW
```

**Expected**: PLANNED status | **Capture**: `ISSUE_NUMBER`

---

## Step 2: Generate Plan

```
Tool: generate_plan
Args: issueNumber: [ISSUE_NUMBER], summary: "Sync test", approach: "Test file", estimatedComplexity: LOW
      tasks: [{"id": "test", "title": "Test task", "description": "Sync test", "type": "TASK"}]
```

**Expected**: 1 task PLANNED | **Capture**: `TASK_ID`

---

## Step 3: Move to Backlog

```
Tool: move_issue_to_backlog
Args: issueNumber: [ISSUE_NUMBER]
```

**Expected**: Task BACKLOG, GitHub issue created, column = "Backlog"

**Capture**: `GITHUB_ISSUE_NUMBER` from response

**Verify**: Run verification query → `State: OPEN, Column: Backlog`

---

## Step 4: Move to Ready

```
Tool: move_issue_to_ready
Args: issueNumber: [ISSUE_NUMBER]
```

**Expected**: Task READY, column = "Ready"

**Verify**: Run verification query → `State: OPEN, Column: Ready`

---

## Step 5: Start Task

```
Tool: load_task_session
Args: taskId: [TASK_ID], sessionId: "sync-test", mode: "isolated"
```

**Expected**: Task IN_PROGRESS, worktree created, column = "In progress"

**Capture**: `WORKTREE_PATH`, `BRANCH_NAME`

**Verify**: Run verification query → `State: OPEN, Column: In progress`

---

## Step 6: Make Commit

```bash
cd [WORKTREE_PATH]
echo "Sync test" > sync-test.txt
git add sync-test.txt
git commit -m "Test: sync verification"
```

---

## Step 7: Create PR

```
Tool: create_pr
Args: taskId: [TASK_ID], title: "Sync Test PR", body: "Testing sync"
```

**Expected**: PR created, task stays IN_PROGRESS

**Capture**: `PR_NUMBER`

---

## Step 8: Submit for Review

```
Tool: submit_for_review
Args: taskId: [TASK_ID]
```

**Expected**: Task PR_REVIEW, column = "In review"

**Verify**: Run verification query → `State: OPEN, Column: In review`

---

## Step 9: Complete Task

First merge the PR:

```bash
gh pr merge [PR_NUMBER] --squash --body "Test complete"
```

Then complete the task:

```
Tool: complete_task
Args: taskId: [TASK_ID], sessionId: "sync-test", finalLogEntry: "Test completed"
```

**Expected**: Task COMPLETED, issue CLOSED, column = "Done"

**Verify**: Run verification query → `State: CLOSED, Column: Done`

---

## Step 10: Cleanup

```
Tool: delete_issue
Args: issueNumber: [ISSUE_NUMBER]
```

```bash
git fetch --prune
```

---

## Test Results

| Step        | Status → Column             | Pass/Fail |
| ----------- | --------------------------- | --------- |
| 3. Backlog  | BACKLOG → "Backlog"         |           |
| 4. Ready    | READY → "Ready"             |           |
| 5. Start    | IN_PROGRESS → "In progress" |           |
| 8. Review   | PR_REVIEW → "In review"     |           |
| 9. Complete | COMPLETED → "Done" + CLOSED |           |

---

## Troubleshooting

### Sync Not Working

| Check                 | Command                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Rebuild & restart MCP | `pnpm --filter @dev-workflow/core build && pnpm --filter @dev-workflow/mcp-server build` then `/mcp` |
| Task sync error       | `sqlite3 ~/.track/workflow.db "SELECT github_last_sync_error FROM tasks WHERE id = '[TASK_ID]'"`     |
| Project config        | `sqlite3 ~/.track/workflow.db "SELECT github_sync FROM projects LIMIT 1"`                            |

### Fix Stuck Project Items

1. Get project item ID:

```bash
gh api graphql -f query='query { repository(owner: "enamrik", name: "dev-workflow") { issue(number: [NUM]) { projectItems(first: 1) { nodes { id } } } } }'
```

2. Move to correct column:

```bash
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: { projectId: "PVT_kwHOAAtNZM4BLyP8", itemId: "[ITEM_ID]", fieldId: "PVTSSF_lAHOAAtNZM4BLyP8zg7QWhw", value: { singleSelectOptionId: "[OPTION_ID]" } }) { projectV2Item { id } } }'
```

### Bulk Cleanup

```bash
gh issue list --search "Sync Test" --state all
for i in [NUMS]; do gh issue close $i --comment "Test cleanup"; done
```

### Discover Project Field IDs

```bash
gh api graphql -f query='query { node(id: "PVT_kwHOAAtNZM4BLyP8") { ... on ProjectV2 { field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } }'
```

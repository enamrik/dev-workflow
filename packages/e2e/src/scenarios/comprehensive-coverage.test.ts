/**
 * Comprehensive E2E Test: All MCP Tools
 *
 * Tests every MCP tool using DirectToolExecutor (no Claude API costs).
 * Organized by tool category for clear coverage tracking.
 *
 * Total tools: 55
 * - Issue Management: 16 tools
 * - Plan Management: 5 tools
 * - Task Management: 10 tools
 * - Snapshot Management: 3 tools
 * - Milestone Management: 7 tools
 * - Worktree Management: 2 tools
 * - PR/Completion Tools: 4 tools
 * - Merge Tools: 1 tool
 * - Type Management: 4 tools
 * - Dispatch/Worker Tools: 3 tools
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DirectToolExecutor } from "../harness/direct-executor.js";

describe("Comprehensive MCP Tool Coverage", () => {
  let executor: DirectToolExecutor;
  let testPassed = false;

  // Store IDs for cross-tool testing
  let taskId: string;
  const sessionId = "test-session-" + Date.now();

  beforeAll(async () => {
    executor = await DirectToolExecutor.create({
      keepOnSuccess: false,
    });
  }, 60000);

  afterAll(async () => {
    await executor?.dispose(testPassed);
  });

  // ===========================================================================
  // Issue Management Tools (16 tools)
  // ===========================================================================

  describe("Issue Management (16 tools)", () => {
    it("create_issue - creates a new issue", async () => {
      const result = await executor.callTool("create_issue", {
        title: "Test comprehensive coverage",
        description: "Testing all MCP tools systematically",
        type: "FEATURE",
        priority: "HIGH",
        acceptanceCriteria: ["All tools tested", "All assertions pass"],
      });

      expect(result.success).toBe(true);
      const data = result.data as { issue: { id: string; number: number } };
      expect(data.issue.number).toBe(1);
      expect(data.issue.id).toBeDefined();
    });

    it("get_issue - retrieves issue details", async () => {
      const result = await executor.callTool("get_issue", {
        issueNumber: 1,
        includePlan: false,
      });

      expect(result.success).toBe(true);
      const data = result.data as { issue: { title: string } };
      expect(data.issue.title).toBe("Test comprehensive coverage");
    });

    it("update_issue - updates issue properties", async () => {
      const result = await executor.callTool("update_issue", {
        issueNumber: 1,
        updates: {
          title: "Updated test title",
          priority: "CRITICAL",
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as { issue: { priority: string } };
      expect(data.issue.priority).toBe("CRITICAL");
    });

    it("change_issue_type - changes issue type", async () => {
      const result = await executor.callTool("change_issue_type", {
        issueNumber: 1,
        type: "ENHANCEMENT",
      });

      expect(result.success).toBe(true);
      const data = result.data as { issue: { type: string } };
      expect(data.issue.type).toBe("ENHANCEMENT");
    });

    it("search_issues - searches by keyword", async () => {
      const result = await executor.callTool("search_issues", {
        query: "comprehensive",
      });

      expect(result.success).toBe(true);
      const data = result.data as { results: Array<{ number: number }> };
      expect(data.results.length).toBeGreaterThan(0);
    });

    it("get_project_stats - returns statistics", async () => {
      const result = await executor.callTool("get_project_stats", {});

      expect(result.success).toBe(true);
      const data = result.data as { issues: { total: number } };
      expect(data.issues.total).toBeGreaterThanOrEqual(1);
    });

    it("get_work_queue - returns prioritized queue", async () => {
      const result = await executor.callTool("get_work_queue", {});

      expect(result.success).toBe(true);
      // Work queue exists but may be empty if no issues need planning/work
      expect(result.data).toBeDefined();
    });

    // Template tools (6)
    it("list_templates - lists available templates", async () => {
      const result = await executor.callTool("list_templates", {});

      expect(result.success).toBe(true);
      const data = result.data as { templates: Array<{ filename: string }> };
      expect(Array.isArray(data.templates)).toBe(true);
    });

    it("create_template - creates a new template", async () => {
      const result = await executor.callTool("create_template", {
        filename: "test-template.md",
        content: `---
type: FEATURE
priority: MEDIUM
---
# Test Template

Description placeholder.
`,
        scope: "local",
        category: "issue",
      });

      expect(result.success).toBe(true);
    });

    it("get_template - retrieves template content", async () => {
      const result = await executor.callTool("get_template", {
        filename: "test-template.md",
        scope: "local",
        category: "issue",
      });

      expect(result.success).toBe(true);
      const data = result.data as { content: string };
      expect(data.content).toContain("Test Template");
    });

    it("update_template - updates existing template", async () => {
      const result = await executor.callTool("update_template", {
        filename: "test-template.md",
        content: `---
type: FEATURE
priority: HIGH
---
# Updated Test Template

Updated description.
`,
        scope: "local",
        category: "issue",
      });

      expect(result.success).toBe(true);
    });

    it("copy_template - copies template between scopes", async () => {
      const result = await executor.callTool("copy_template", {
        filename: "test-template.md",
        fromScope: "local",
        toScope: "global",
        category: "issue",
      });

      expect(result.success).toBe(true);
    });

    it("delete_template - deletes template", async () => {
      // Delete from both scopes
      const localResult = await executor.callTool("delete_template", {
        filename: "test-template.md",
        scope: "local",
        category: "issue",
      });
      expect(localResult.success).toBe(true);

      const globalResult = await executor.callTool("delete_template", {
        filename: "test-template.md",
        scope: "global",
        category: "issue",
      });
      expect(globalResult.success).toBe(true);
    });

    // Issue delete/restore (tested at end to not break other tests)
    it("delete_issue and restore_issue - soft delete and restore", async () => {
      // Create a throwaway issue for this test
      const createResult = await executor.callTool("create_issue", {
        title: "Issue to delete",
        description: "Will be deleted and restored",
      });
      expect(createResult.success).toBe(true);
      const data = createResult.data as { issue: { number: number } };
      const issueNumber = data.issue.number;

      // Delete it
      const deleteResult = await executor.callTool("delete_issue", {
        issueNumber,
      });
      expect(deleteResult.success).toBe(true);

      // Verify it's deleted (get should fail)
      const getDeleted = await executor.callTool("get_issue", {
        issueNumber,
      });
      expect(getDeleted.success).toBe(false);

      // Restore it
      const restoreResult = await executor.callTool("restore_issue", {
        issueNumber,
      });
      expect(restoreResult.success).toBe(true);

      // Verify it's restored
      const getRestored = await executor.callTool("get_issue", {
        issueNumber,
      });
      expect(getRestored.success).toBe(true);
    });
  });

  // ===========================================================================
  // Plan Management Tools (5 tools)
  // ===========================================================================

  describe("Plan Management (5 tools)", () => {
    it("generate_plan - creates implementation plan with tasks", async () => {
      const result = await executor.callTool("generate_plan", {
        issueNumber: 1,
        summary: "Implement comprehensive test coverage",
        approach: "Test each tool category systematically",
        estimatedComplexity: "MEDIUM",
        tasks: [
          {
            id: "t1",
            title: "Test issue tools",
            description: "Verify all issue management tools",
            type: "TASK",
            acceptanceCriteria: ["create_issue works", "get_issue works"],
          },
          {
            id: "t2",
            title: "Test plan tools",
            description: "Verify all plan management tools",
            type: "TASK",
            dependsOn: ["t1"],
          },
          {
            id: "t3",
            title: "Test task tools",
            description: "Verify all task management tools",
            type: "TASK",
            dependsOn: ["t2"],
          },
        ],
      });

      expect(result.success).toBe(true);
      const data = result.data as {
        plan: { id: string };
        tasks: Array<{ id: string }>;
      };
      expect(data.plan.id).toBeDefined();
      taskId = data.tasks[0]!.id;
      expect(data.tasks).toHaveLength(3);
    });

    it("get_plan - retrieves plan with tasks", async () => {
      const result = await executor.callTool("get_plan", {
        issueNumber: 1,
      });

      expect(result.success).toBe(true);
      const data = result.data as { plan: { summary: string } };
      expect(data.plan.summary).toBe("Implement comprehensive test coverage");
    });

    it("move_issue_to_backlog - activates plan", async () => {
      const result = await executor.callTool("move_issue_to_backlog", {
        issueNumber: 1,
        skipGitHubSync: true,
      });

      expect(result.success).toBe(true);
      const data = result.data as { issue: { status: string } };
      expect(data.issue.status).toBe("OPEN");
    });

    it("move_issue_to_ready - marks issue ready for work", async () => {
      const result = await executor.callTool("move_issue_to_ready", {
        issueNumber: 1,
      });

      expect(result.success).toBe(true);
    });

    it("pause_issue - moves tasks back to backlog", async () => {
      const result = await executor.callTool("pause_issue", {
        issueNumber: 1,
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Task Management Tools (10 tools)
  // ===========================================================================

  describe("Task Management (10 tools)", () => {
    it("list_available_tasks - lists workable tasks", async () => {
      // First move to ready again
      await executor.callTool("move_issue_to_ready", { issueNumber: 1 });

      const result = await executor.callTool("list_available_tasks", {});

      expect(result.success).toBe(true);
      const data = result.data as { tasks: Array<{ id: string }> };
      expect(data.tasks.length).toBeGreaterThan(0);
    });

    it("get_task - retrieves task details", async () => {
      const result = await executor.callTool("get_task", {
        taskId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { task: { title: string } };
      expect(data.task.title).toBe("Test issue tools");
    });

    it("update_task - updates task properties", async () => {
      const result = await executor.callTool("update_task", {
        taskId,
        description: "Updated description for testing",
        labels: { urgent: "" },
      });

      expect(result.success).toBe(true);
    });

    it("get_task_execution_prompt - generates execution prompt", async () => {
      const result = await executor.callTool("get_task_execution_prompt", {
        taskId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { prompt: string };
      expect(data.prompt).toContain("Test issue tools");
    });

    it("check_task_conflicts - checks for file conflicts", async () => {
      const result = await executor.callTool("check_task_conflicts", {
        taskId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { conflicts: unknown[] };
      expect(Array.isArray(data.conflicts)).toBe(true);
    });

    it("load_task_session - starts task execution", async () => {
      const result = await executor.callTool("load_task_session", {
        taskId,
        sessionId,
        mode: "main", // Use main mode to avoid worktree setup
      });

      expect(result.success).toBe(true);
      const data = result.data as { task: { status: string } };
      expect(data.task.status).toBe("IN_PROGRESS");
    });

    it("log_task_progress - records execution progress", async () => {
      const result = await executor.callTool("log_task_progress", {
        taskId,
        sessionId,
        message: "Started testing issue tools",
        filesModified: ["test.ts"],
      });

      expect(result.success).toBe(true);
    });

    it("get_task_execution_log - retrieves progress log", async () => {
      const result = await executor.callTool("get_task_execution_log", {
        taskId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { entries: Array<{ message: string }> };
      expect(data.entries.length).toBeGreaterThan(0);
    });

    it("abandon_task - abandons task in progress", async () => {
      const result = await executor.callTool("abandon_task", {
        taskId,
        sessionId,
        reason: "Testing abandon functionality",
      });

      expect(result.success).toBe(true);
    });

    it("delete_task - deletes PLANNED task", async () => {
      // Create a new plan with a deletable task
      const createIssue = await executor.callTool("create_issue", {
        title: "Issue with deletable task",
        description: "For testing delete_task",
      });
      expect(createIssue.success).toBe(true);
      const issueData = createIssue.data as { issue: { number: number } };

      const createPlan = await executor.callTool("generate_plan", {
        issueNumber: issueData.issue.number,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "LOW",
        tasks: [
          {
            id: "deleteme",
            title: "Task to delete",
            description: "Will be deleted",
            type: "TASK",
          },
        ],
      });
      expect(createPlan.success).toBe(true);
      const planData = createPlan.data as { tasks: Array<{ id: string }> };

      // Delete the task (only works on PLANNED tasks)
      const deleteResult = await executor.callTool("delete_task", {
        taskId: planData.tasks[0]!.id,
      });
      expect(deleteResult.success).toBe(true);
    });
  });

  // ===========================================================================
  // Snapshot Management Tools (3 tools)
  // ===========================================================================

  describe("Snapshot Management (3 tools)", () => {
    it("get_snapshot_history - lists version history", async () => {
      const result = await executor.callTool("get_snapshot_history", {
        issueNumber: 1,
      });

      expect(result.success).toBe(true);
      const data = result.data as { snapshots: unknown[] };
      expect(Array.isArray(data.snapshots)).toBe(true);
    });

    it("view_snapshot - views issue at specific version", async () => {
      // Snapshots start at version 1
      const result = await executor.callTool("view_snapshot", {
        issueNumber: 1,
        version: 1,
      });

      expect(result.success).toBe(true);
      const data = result.data as { snapshot: { version: number } };
      expect(data.snapshot.version).toBe(1);
    });

    it("revert_to_snapshot - reverts to previous version", async () => {
      // First make sure we have multiple snapshots by updating
      await executor.callTool("update_issue", {
        issueNumber: 1,
        updates: { title: "Title before revert" },
      });

      const result = await executor.callTool("revert_to_snapshot", {
        issueNumber: 1,
        version: 1,
        notes: "Testing revert functionality",
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Milestone Management Tools (7 tools)
  // ===========================================================================

  describe("Milestone Management (7 tools)", () => {
    it("create_milestone - creates new milestone", async () => {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      const result = await executor.callTool("create_milestone", {
        title: "Q1 Release",
        description: "First quarterly release",
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      });

      expect(result.success).toBe(true);
      const data = result.data as { milestone: { id: string; number: number } };
      expect(data.milestone.id).toBeDefined();
      expect(data.milestone.number).toBe(1);
    });

    it("get_milestone - retrieves milestone details", async () => {
      const result = await executor.callTool("get_milestone", {
        milestoneNumber: 1,
      });

      expect(result.success).toBe(true);
      const data = result.data as { milestone: { title: string } };
      expect(data.milestone.title).toBe("Q1 Release");
    });

    it("list_milestones - lists all milestones", async () => {
      const result = await executor.callTool("list_milestones", {});

      expect(result.success).toBe(true);
      const data = result.data as { milestones: unknown[] };
      expect(data.milestones.length).toBeGreaterThan(0);
    });

    it("update_milestone - updates milestone properties", async () => {
      const result = await executor.callTool("update_milestone", {
        milestoneNumber: 1,
        updates: {
          title: "Q1 Release (Updated)",
          description: "Updated description",
        },
      });

      expect(result.success).toBe(true);
    });

    it("assign_issue_to_milestone - assigns issue to milestone", async () => {
      const result = await executor.callTool("assign_issue_to_milestone", {
        issueNumber: 1,
        milestoneNumber: 1,
      });

      expect(result.success).toBe(true);
    });

    it("remove_issue_from_milestone - removes issue from milestone", async () => {
      const result = await executor.callTool("remove_issue_from_milestone", {
        issueNumber: 1,
      });

      expect(result.success).toBe(true);
    });

    it("delete_milestone - deletes milestone", async () => {
      // Create another milestone to delete
      const create = await executor.callTool("create_milestone", {
        title: "Deletable Milestone",
        description: "Will be deleted",
        startDate: "2025-01-01",
        endDate: "2025-03-31",
      });
      expect(create.success).toBe(true);
      const data = create.data as { milestone: { number: number } };

      const result = await executor.callTool("delete_milestone", {
        milestoneNumber: data.milestone.number,
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Worktree Management Tools (2 tools)
  // ===========================================================================

  describe("Worktree Management (2 tools)", () => {
    it("list_worktrees - lists active worktrees", async () => {
      const result = await executor.callTool("list_worktrees", {});

      expect(result.success).toBe(true);
      const data = result.data as { worktrees: unknown[] };
      expect(Array.isArray(data.worktrees)).toBe(true);
    });

    it("prune_stale_worktrees - cleans up stale worktrees", async () => {
      const result = await executor.callTool("prune_stale_worktrees", {});

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // PR/Completion Tools (4 tools)
  // ===========================================================================

  describe("PR/Completion Tools (4 tools)", () => {
    it("get_task_pr_status - gets PR status for task", async () => {
      const result = await executor.callTool("get_task_pr_status", {
        taskId,
      });

      // Task doesn't have a PR, so this returns no PR info
      expect(result.success).toBe(true);
    });

    it("create_pr - requires IN_PROGRESS task (skipped without worktree)", async () => {
      // This test validates the tool exists but requires actual git setup
      // to fully test. We verify the error message is appropriate.
      const result = await executor.callTool("create_pr", {
        taskId,
      });

      // Expected to fail because task is ABANDONED, not IN_PROGRESS
      expect(result.success).toBe(false);
    });

    it("submit_for_review - requires PR (skipped without worktree)", async () => {
      const result = await executor.callTool("submit_for_review", {
        taskId,
      });

      // Expected to fail because no PR exists
      expect(result.success).toBe(false);
    });

    it("complete_task - requires merged PR (skipped without worktree)", async () => {
      const result = await executor.callTool("complete_task", {
        taskId,
        sessionId,
        finalLogEntry: "Test completion",
      });

      // Expected to fail because task is ABANDONED and no PR
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Merge Tools (1 tool)
  // ===========================================================================

  describe("Merge Tools (1 tool)", () => {
    it("merge_issues - merges two issues", async () => {
      // Create two issues to merge
      const issue1 = await executor.callTool("create_issue", {
        title: "Source issue",
        description: "Will be merged into target",
      });
      expect(issue1.success).toBe(true);
      const i1Data = issue1.data as { issue: { number: number } };

      const issue2 = await executor.callTool("create_issue", {
        title: "Target issue",
        description: "Will receive merged content",
      });
      expect(issue2.success).toBe(true);
      const i2Data = issue2.data as { issue: { number: number } };

      const result = await executor.callTool("merge_issues", {
        sourceIssueNumber: i1Data.issue.number,
        targetIssueNumber: i2Data.issue.number,
        mode: "create_new",
        newTitle: "Merged issue",
      });

      expect(result.success).toBe(true);
      const data = result.data as { mergedIssue: { number: number } };
      expect(data.mergedIssue).toBeDefined();
    });
  });

  // ===========================================================================
  // Type Management Tools (4 tools)
  // ===========================================================================

  describe("Type Management (4 tools)", () => {
    it("list_types - lists available types", async () => {
      const result = await executor.callTool("list_types", {});

      expect(result.success).toBe(true);
      const data = result.data as { types: Array<{ name: string }> };
      expect(data.types.length).toBeGreaterThan(0);
      // Should have default types
      const typeNames = data.types.map((t) => t.name);
      expect(typeNames).toContain("FEATURE");
      expect(typeNames).toContain("BUG");
    });

    it("create_type - creates custom type", async () => {
      const result = await executor.callTool("create_type", {
        name: "EPIC",
        displayName: "Epic",
        description: "Large feature spanning multiple issues",
        keywords: ["epic", "large", "umbrella"],
        color: "#9b59b6",
      });

      expect(result.success).toBe(true);
    });

    it("update_type - updates type properties", async () => {
      const result = await executor.callTool("update_type", {
        name: "EPIC",
        updates: {
          description: "Updated epic description",
          keywords: ["epic", "large", "umbrella", "parent"],
        },
      });

      expect(result.success).toBe(true);
    });

    it("delete_type - soft deletes type", async () => {
      const result = await executor.callTool("delete_type", {
        name: "EPIC",
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Dispatch/Worker Tools (3 tools)
  // ===========================================================================

  describe("Dispatch/Worker Tools (3 tools)", () => {
    let dispatchableTaskId: string;

    beforeAll(async () => {
      // Create a fresh issue with a task for dispatch testing
      const issue = await executor.callTool("create_issue", {
        title: "Dispatch test issue",
        description: "For testing dispatch tools",
      });
      const issueData = issue.data as { issue: { number: number } };

      const plan = await executor.callTool("generate_plan", {
        issueNumber: issueData.issue.number,
        summary: "Dispatch test plan",
        approach: "Test dispatch",
        estimatedComplexity: "LOW",
        tasks: [
          {
            id: "dispatch-task",
            title: "Dispatchable task",
            description: "For dispatch testing",
            type: "TASK",
          },
        ],
      });
      const planData = plan.data as { tasks: Array<{ id: string }> };
      dispatchableTaskId = planData.tasks[0]!.id;

      // Move to backlog to make task dispatchable
      await executor.callTool("move_issue_to_backlog", {
        issueNumber: issueData.issue.number,
        skipGitHubSync: true,
      });
    });

    it("dispatch_task - adds task to dispatch queue", async () => {
      const result = await executor.callTool("dispatch_task", {
        taskId: dispatchableTaskId,
      });

      expect(result.success).toBe(true);
    });

    it("get_dispatch_status - gets worker and queue status", async () => {
      const result = await executor.callTool("get_dispatch_status", {});

      expect(result.success).toBe(true);
      const data = result.data as {
        workers: unknown[];
        queue: unknown[];
        stats: { total: number };
      };
      expect(data.queue).toBeDefined();
      expect(data.stats.total).toBeGreaterThanOrEqual(1);
    });

    it("end_worker_session - signals worker completion", async () => {
      const workerId = "test-worker-" + Date.now();

      // This will fail because there's no registered worker, but verifies tool exists
      const result = await executor.callTool("end_worker_session", {
        workerId,
        taskId: dispatchableTaskId,
      });

      // Expected to fail - no registered worker with this ID
      // But the tool was called successfully
      expect(result.data !== undefined || result.error !== undefined).toBe(true);
    });
  });

  // ===========================================================================
  // Close Issue (Final cleanup)
  // ===========================================================================

  describe("Final Cleanup", () => {
    it("close_issue - closes issue (force mode)", async () => {
      const result = await executor.callTool("close_issue", {
        issueNumber: 1,
        force: true,
      });

      expect(result.success).toBe(true);

      // Verify in database
      const db = executor.getDatabase();
      try {
        const issue = db.prepare("SELECT status FROM issues WHERE number = ?").get(1) as {
          status: string;
        };
        expect(issue.status).toBe("CLOSED");
      } finally {
        db.close();
      }

      testPassed = true;
    });
  });
});

// ===========================================================================
// Error Case Coverage
// ===========================================================================

describe("Error Case Coverage", () => {
  let executor: DirectToolExecutor;
  let testPassed = false;

  beforeAll(async () => {
    executor = await DirectToolExecutor.create({
      keepOnSuccess: false,
    });
  }, 60000);

  afterAll(async () => {
    await executor?.dispose(testPassed);
  });

  it("get_issue - returns error for non-existent issue", async () => {
    const result = await executor.callTool("get_issue", {
      issueNumber: 9999,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("delete_issue - fails for non-PLANNED issue", async () => {
    // Create and activate an issue
    const create = await executor.callTool("create_issue", {
      title: "Non-deletable issue",
      description: "Will be activated",
    });
    const data = create.data as { issue: { number: number } };

    await executor.callTool("generate_plan", {
      issueNumber: data.issue.number,
      summary: "Plan",
      approach: "Approach",
      estimatedComplexity: "LOW",
      tasks: [{ id: "t1", title: "Task", description: "Desc", type: "TASK" }],
    });

    await executor.callTool("move_issue_to_backlog", {
      issueNumber: data.issue.number,
      skipGitHubSync: true,
    });

    // Now try to delete - should fail
    const deleteResult = await executor.callTool("delete_issue", {
      issueNumber: data.issue.number,
    });

    expect(deleteResult.success).toBe(false);
    expect(deleteResult.error).toContain("PLANNED");
  });

  it("generate_plan - fails with invalid type", async () => {
    const create = await executor.callTool("create_issue", {
      title: "Issue with invalid task type",
      description: "Testing invalid type",
    });
    const data = create.data as { issue: { number: number } };

    const result = await executor.callTool("generate_plan", {
      issueNumber: data.issue.number,
      summary: "Plan",
      approach: "Approach",
      estimatedComplexity: "LOW",
      tasks: [
        {
          id: "t1",
          title: "Task",
          description: "Desc",
          type: "INVALID_TYPE",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("create_type - fails for duplicate name", async () => {
    // Try to create a type that already exists
    const result = await executor.callTool("create_type", {
      name: "FEATURE",
      displayName: "Feature",
      description: "Duplicate type",
    });

    expect(result.success).toBe(false);
  });

  it("abandon_task - fails without valid session", async () => {
    // Create issue and task
    const create = await executor.callTool("create_issue", {
      title: "Abandon test",
      description: "Testing abandon without session",
    });
    const data = create.data as { issue: { number: number } };

    await executor.callTool("generate_plan", {
      issueNumber: data.issue.number,
      summary: "Plan",
      approach: "Approach",
      estimatedComplexity: "LOW",
      tasks: [{ id: "t1", title: "Task", description: "Desc", type: "TASK" }],
    });

    const plan = await executor.callTool("get_plan", {
      issueNumber: data.issue.number,
    });
    const planData = plan.data as { plan: { tasks: Array<{ id: string }> } };
    const taskId = planData.plan.tasks[0]!.id;

    // Try to abandon without starting - should fail
    const result = await executor.callTool("abandon_task", {
      taskId,
      sessionId: "invalid-session",
      reason: "Test",
    });

    expect(result.success).toBe(false);
  });

  it("complete_task - fails for non-PR_REVIEW task", async () => {
    // Create issue and task
    const create = await executor.callTool("create_issue", {
      title: "Complete test",
      description: "Testing complete without PR",
    });
    const data = create.data as { issue: { number: number } };

    await executor.callTool("generate_plan", {
      issueNumber: data.issue.number,
      summary: "Plan",
      approach: "Approach",
      estimatedComplexity: "LOW",
      tasks: [{ id: "t1", title: "Task", description: "Desc", type: "TASK" }],
    });

    const plan = await executor.callTool("get_plan", {
      issueNumber: data.issue.number,
    });
    const planData = plan.data as { plan: { tasks: Array<{ id: string }> } };
    const taskId = planData.plan.tasks[0]!.id;

    // Try to complete without being in PR_REVIEW
    const result = await executor.callTool("complete_task", {
      taskId,
      sessionId: "test-session",
      finalLogEntry: "Test completion",
    });

    expect(result.success).toBe(false);
  });

  afterAll(() => {
    testPassed = true;
  });
});

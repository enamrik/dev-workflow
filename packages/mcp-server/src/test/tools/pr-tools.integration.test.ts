/**
 * PR Tools Integration Tests
 *
 * Tests PR-related MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../helpers.js";
import {
  MockGitHubCLI,
  MockGitWorktreeService,
  SqliteProjectRepository,
  TaskGitHubSyncService,
} from "@dev-workflow/core";
import { handleSubmitForReview, type PRToolContext } from "../../tools/pr-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_PROJECT_ID = "test-project-pr";

/**
 * Create a PRToolContext for testing
 */
function createPRToolContext(
  testDb: TestDatabase,
  mockGitHubCLI?: MockGitHubCLI,
  mockGitWorktreeService?: MockGitWorktreeService
): PRToolContext {
  const db = testDb.db as DbType;
  const repos = createRepositories(testDb.db, TEST_PROJECT_ID);
  const projectRepository = new SqliteProjectRepository(db);

  const githubCLI = mockGitHubCLI ?? new MockGitHubCLI();
  const gitWorktreeService = mockGitWorktreeService ?? new MockGitWorktreeService();

  const taskGitHubSyncService = new TaskGitHubSyncService(
    repos.taskRepository,
    repos.issueRepository,
    repos.planRepository,
    githubCLI,
    projectRepository,
    TEST_PROJECT_ID
  );

  return {
    githubCLI,
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    gitWorktreeService,
    taskGitHubSyncService,
  };
}

describe("submit_for_review", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("PR title format", () => {
    it("should use plain title with no prefix when task has no GitHub issue", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      // Create issue #1 (no GitHub sync)
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Issue",
      });
      const plan = createTestPlan(ctx.planRepository, issue.id);

      // Create task #2 (the second task in the plan)
      createTestTask(ctx.taskRepository, plan.id, {
        title: "First Task",
        status: "COMPLETED",
      });
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Update feature",
        status: "IN_PROGRESS",
      });

      // Set up task with branch and worktree but NO GitHub sync
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-2-update-feature",
        worktreePath: "/tmp/worktree/issue-1-task-2",
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify the PR was created with plain title (no prefix)
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(1);

      const [, , prTitle] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      // No prefix when task has no linked GitHub issue
      expect(prTitle).toBe("Update feature");
    });

    it("should use GitHub issue number prefix when task has linked GitHub issue", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      // Create dev-workflow issue #1
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Issue",
      });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Implement feature",
        status: "IN_PROGRESS",
      });

      // Set up task with branch, worktree, and linked GitHub issue #42
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-implement-feature",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      ctx.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify the PR was created with GitHub issue number in title (no task number)
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(1);

      const [, , prTitle] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      // Should use GitHub issue number (42) with no task number suffix
      expect(prTitle).toBe("[#42] Implement feature");
    });

    it("should include dev-workflow task reference in PR body footer", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      // Create dev-workflow issue #1 (no GitHub sync)
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Local Issue",
      });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Local task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      // Set up task with branch and worktree but NO GitHub sync
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-local-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify the PR body contains dev-workflow task reference
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(1);

      const [, , , prBody] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      // PR body should contain the dev-workflow task reference as footer
      expect(prBody).toContain(`Task ${issue.number}.${task.number}: Local task`);
    });

    it("should include GitHub issue links in PR body when synced", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Issue",
      });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      // Set up task with branch, worktree, and linked GitHub issue
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      ctx.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 99,
        githubUrl: "https://github.com/test/repo/issues/99",
        githubNodeId: "I_test_99",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify the PR body contains GitHub issue link and dev-workflow reference
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(1);

      const [, , , prBody] = createPRCalls[0]!.args as [string, string, string, string, boolean];

      // PR body should contain Closes link to task's GitHub issue
      expect(prBody).toContain("Closes #99");
      // PR body should contain dev-workflow task reference (not italic)
      expect(prBody).toContain(`Task ${issue.number}.${task.number}: Test task`);
    });
  });
});

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
import { handleCreatePR, handleSubmitForReview, type PRToolContext } from "../../tools/pr-tools.js";
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

describe("create_pr", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("PR creation", () => {
    it("should create PR without changing task status", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Implement feature",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-implement-feature",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("IN_PROGRESS"); // Status unchanged

      // Verify PR was created
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(1);

      // Verify task still has IN_PROGRESS status in DB
      const updatedTask = ctx.taskRepository.findById(task.id);
      expect(updatedTask?.status).toBe("IN_PROGRESS");
      expect(updatedTask?.prNumber).toBeDefined();
    });

    it("should use plain title when task has no GitHub issue", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Update feature",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-update-feature",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      const [, , prTitle] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      expect(prTitle).toBe("Update feature");
    });

    it("should use task's GitHub issue number prefix in PR title", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Implement feature",
        status: "IN_PROGRESS",
      });

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
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      const [, , prTitle] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      expect(prTitle).toBe("[#42] Implement feature");
    });

    it("should include GitHub issue links in PR body when synced", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

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
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      const [, , , prBody] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      expect(prBody).toContain("Closes #99");
      expect(prBody).toContain(`Task ${issue.number}.${task.number}: Test task`);
    });
  });

  describe("validation", () => {
    it("should fail if task is not IN_PROGRESS", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "READY", // Not IN_PROGRESS
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("must be IN_PROGRESS");
    });

    it("should succeed with force=true when task is not IN_PROGRESS", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "READY", // Not IN_PROGRESS
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id, force: true });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.forced).toBe(true);
    });

    it("should fail if task has no branch", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });
      // No branch set

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not have a branch");
    });

    it("should fail if task already has a PR", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      ctx.taskRepository.updatePRInfo(
        task.id,
        "https://github.com/test/repo/pull/123",
        123,
        "OPEN"
      );

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already has a PR");
    });
  });
});

describe("submit_for_review", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("status transition", () => {
    it("should transition task to PR_REVIEW when PR exists", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Set up task with branch and existing PR
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      ctx.taskRepository.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("PR_REVIEW");

      // Verify task status changed in DB
      const updatedTask = ctx.taskRepository.findById(task.id);
      expect(updatedTask?.status).toBe("PR_REVIEW");
    });

    it("should NOT create a PR - only change status", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      ctx.taskRepository.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Act
      await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert - NO PR creation should happen
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      expect(createPRCalls).toHaveLength(0);
    });
  });

  describe("validation", () => {
    it("should fail if task is not IN_PROGRESS", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "READY", // Not IN_PROGRESS
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("must be IN_PROGRESS");
    });

    it("should fail if task has no PR", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });
      // No PR set

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not have a PR");
      expect(result.content[0].text).toContain("create_pr first");
    });

    it("should succeed with force=true when task has no PR", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const ctx = createPRToolContext(testDb, mockGitHubCLI);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });
      // No PR set

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id, force: true });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.forced).toBe(true);
      expect(content.task.status).toBe("PR_REVIEW");
    });

    it("should succeed with force=true when task is not IN_PROGRESS", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const ctx = createPRToolContext(testDb, mockGitHubCLI);

      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "PR_REVIEW", // Already in PR_REVIEW
      });

      ctx.taskRepository.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id, force: true });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.forced).toBe(true);
    });
  });

  describe("GitHub Project column sync", () => {
    it("should move task to In Review column when project is configured", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const db = testDb.db as DbType;

      // Create a project with GitHub sync enabled (including projectId)
      const projectRepository = new SqliteProjectRepository(db);
      const project = projectRepository.create({
        name: "Test Project",
        gitRootHash: "test-hash-123",
        gitRoot: "/test/repo",
        githubSync: {
          enabled: true,
          projectId: "PVT_test_project",
          labels: {
            typeLabels: {
              FEATURE: "feature",
              BUG: "bug",
              ENHANCEMENT: "enhancement",
              TASK: "task",
            },
          },
        },
      });

      // Create repositories and services with the actual project ID
      const repos = createRepositories(testDb.db, project.id);
      const taskGitHubSyncService = new TaskGitHubSyncService(
        repos.taskRepository,
        repos.issueRepository,
        repos.planRepository,
        mockGitHubCLI,
        projectRepository,
        project.id
      );

      const ctx: PRToolContext = {
        githubCLI: mockGitHubCLI,
        issueRepository: repos.issueRepository,
        planRepository: repos.planRepository,
        taskRepository: repos.taskRepository,
        gitWorktreeService: mockGitWorktreeService,
        taskGitHubSyncService,
      };

      // Create issue, plan, and task
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Set up task with branch, worktree, PR, and GitHub sync (including projectItemId)
      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      ctx.taskRepository.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");
      ctx.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: "PVTI_test_item_123",
      });

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify the column move was attempted
      const runCalls = mockGitHubCLI.getCallsTo("run");
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg: string) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();

      // Verify the call includes the correct item ID and "In Review" option
      const updateArgs = updateCall!.args[0] as string[];
      expect(updateArgs.some((arg: string) => arg.includes("PVTI_test_item_123"))).toBe(true);
      expect(updateArgs.some((arg: string) => arg.includes("opt_in_review"))).toBe(true);
    });
  });
});

describe("two-step PR workflow", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it("should complete full flow: create_pr then submit_for_review", async () => {
    // Arrange
    const mockGitHubCLI = new MockGitHubCLI();
    const mockGitWorktreeService = new MockGitWorktreeService();
    const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

    const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
    const plan = createTestPlan(ctx.planRepository, issue.id);
    const task = createTestTask(ctx.taskRepository, plan.id, {
      title: "Implement feature",
      status: "IN_PROGRESS",
    });

    ctx.taskRepository.update(task.id, {
      branchName: "issue-1/task-1-implement-feature",
      worktreePath: "/tmp/worktree/issue-1-task-1",
    });

    // Step 1: Create PR
    const createResult = await handleCreatePR(ctx, { taskId: task.id });
    expect(createResult.isError).toBeFalsy();

    // Verify status is still IN_PROGRESS after create_pr
    const taskAfterCreate = ctx.taskRepository.findById(task.id);
    expect(taskAfterCreate?.status).toBe("IN_PROGRESS");
    expect(taskAfterCreate?.prNumber).toBeDefined();

    // Step 2: Submit for review
    const submitResult = await handleSubmitForReview(ctx, { taskId: task.id });
    expect(submitResult.isError).toBeFalsy();

    // Verify status is now PR_REVIEW
    const taskAfterSubmit = ctx.taskRepository.findById(task.id);
    expect(taskAfterSubmit?.status).toBe("PR_REVIEW");
  });

  it("should allow delayed submit_for_review (PR created earlier)", async () => {
    // Arrange
    const mockGitHubCLI = new MockGitHubCLI();
    const mockGitWorktreeService = new MockGitWorktreeService();
    const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

    const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
    const plan = createTestPlan(ctx.planRepository, issue.id);
    const task = createTestTask(ctx.taskRepository, plan.id, {
      title: "Implement feature",
      status: "IN_PROGRESS",
    });

    ctx.taskRepository.update(task.id, {
      branchName: "issue-1/task-1-implement-feature",
      worktreePath: "/tmp/worktree/issue-1-task-1",
    });

    // Step 1: Create PR
    await handleCreatePR(ctx, { taskId: task.id });

    // Simulate time passing - task is still IN_PROGRESS with PR open
    // User might push more commits before submitting for review

    // Step 2: Submit for review later
    const submitResult = await handleSubmitForReview(ctx, { taskId: task.id });
    expect(submitResult.isError).toBeFalsy();

    const content = JSON.parse(submitResult.content[0].text);
    expect(content.task.status).toBe("PR_REVIEW");
  });
});

/**
 * PR Tools Integration Tests
 *
 * Tests PR-related MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../helpers.js";
import {
  MockGitHubCLI,
  MockGitWorktreeService,
  SqliteProjectRepository,
  TaskGitHubSyncService,
  taskExecutionLogs,
  type SqliteDataSource,
  type ProjectManagementProvider,
} from "@dev-workflow/core";
import {
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
  type PRToolContext,
} from "../../tools/pr-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_PROJECT_ID = "test-project-pr";

/**
 * Create a mock SqliteDataSource for testing
 * Only implements getDb() which is what PRToolContext needs
 */
function createMockDbService(db: DbType) {
  return {
    getDb: () => db,
    // Other methods not needed for PR tools
    close: () => {},
  };
}

/**
 * Create a minimal mock provider for testing
 */
function createMockProvider(): ProjectManagementProvider {
  return {
    providerId: "mock",
    displayName: "Mock Provider",
    checkAuth: async () => ({ authenticated: true }),
    checkRepository: async () => ({ accessible: true }),
    createIssue: async () => ({
      id: "1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_1",
      title: "Mock",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    updateIssue: async () => ({
      id: "1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_1",
      title: "Mock",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    getIssue: async () => null,
    searchIssues: async () => [],
    ensureLabelsExist: async () => {},
    addToProject: async () => ({ success: true, itemId: "mock_item" }),
    moveToColumn: async () => {},
    checkProject: async () => true,
    getProjectDetails: async () => null,
    getProjectStatusField: async () => null,
    linkParentChild: async () => {},
    addComment: async () => {},
  };
}

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
  const mockProvider = createMockProvider();

  const taskGitHubSyncService = new TaskGitHubSyncService(
    repos.taskRepository,
    repos.issueRepository,
    repos.planRepository,
    mockProvider,
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
    dbService: createMockDbService(db) as unknown as SqliteDataSource,
    taskExecutionLogsSchema: taskExecutionLogs,
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

    it("should NOT include 'Part of' for regular tasks (parent not imported)", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, { title: "Regular Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Regular task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-regular-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Set GitHub sync for BOTH task and parent issue (but parent is NOT imported)
      ctx.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 101,
        githubUrl: "https://github.com/test/repo/issues/101",
        githubNodeId: "I_test_101",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      ctx.issueRepository.update(issue.id, {
        githubSync: {
          githubIssueNumber: 100,
          githubUrl: "https://github.com/test/repo/issues/100",
          githubNodeId: "I_test_100",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      const [, , , prBody] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      expect(prBody).toContain("Closes #101"); // Task's own issue
      expect(prBody).not.toContain("Part of #100"); // Should NOT include parent reference
      expect(prBody).toContain(`Task ${issue.number}.${task.number}: Regular task`);
    });

    it("should include 'Part of' for sub-issue tasks (parent imported from GitHub)", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const ctx = createPRToolContext(testDb, mockGitHubCLI, mockGitWorktreeService);

      const issue = createTestIssue(ctx.issueRepository, {
        title: "Imported Issue",
      });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Sub-issue task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      ctx.taskRepository.update(task.id, {
        branchName: "issue-1/task-1-sub-issue-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Set GitHub sync for BOTH task and parent issue, AND mark parent as imported
      ctx.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 201,
        githubUrl: "https://github.com/test/repo/issues/201",
        githubNodeId: "I_test_201",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      ctx.issueRepository.update(issue.id, {
        sourceGitHubIssueNumber: 200, // Mark as imported
        githubSync: {
          githubIssueNumber: 200,
          githubUrl: "https://github.com/test/repo/issues/200",
          githubNodeId: "I_test_200",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      // Act
      const result = await handleCreatePR(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const createPRCalls = mockGitHubCLI.getCallsTo("createPR");
      const [, , , prBody] = createPRCalls[0]!.args as [string, string, string, string, boolean];
      expect(prBody).toContain("Closes #201"); // Task's own issue
      expect(prBody).toContain("Part of #200"); // SHOULD include parent reference for imported issues
      expect(prBody).toContain(`Task ${issue.number}.${task.number}: Sub-issue task`);
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
      // Create a mock provider that tracks calls using vitest spies
      const moveToColumnMock = vi.fn().mockResolvedValue(undefined);
      const mockProvider: ProjectManagementProvider = {
        ...createMockProvider(),
        moveToColumn: moveToColumnMock,
      };
      const taskGitHubSyncService = new TaskGitHubSyncService(
        repos.taskRepository,
        repos.issueRepository,
        repos.planRepository,
        mockProvider,
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
        dbService: createMockDbService(db) as unknown as SqliteDataSource,
        taskExecutionLogsSchema: taskExecutionLogs,
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

      // Verify the column move was attempted via the provider
      expect(moveToColumnMock).toHaveBeenCalledWith(
        "PVTI_test_item_123",
        "PVT_test_project",
        "In Review"
      );
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

describe("complete_task", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("finalLogEntry requirement", () => {
    it("should fail if finalLogEntry is not provided", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Act - call without finalLogEntry
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "",
      });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("finalLogEntry is required");
    });

    it("should fail if finalLogEntry is only whitespace", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Act - call with whitespace-only finalLogEntry
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "   \n\t  ",
      });

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("finalLogEntry is required");
    });

    it("should write finalLogEntry to execution log on successful completion (main mode)", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });
      // No branch = main mode

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Implemented feature X with tests",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("COMPLETED");

      // Verify log entry was written
      const db = testDb.db as DbType;
      const logs = db
        .select()
        .from(taskExecutionLogs)
        .where(eq(taskExecutionLogs.taskId, task.id))
        .all();

      expect(logs).toHaveLength(1);
      expect(logs[0]?.message).toBe("Implemented feature X with tests");
      expect(logs[0]?.sessionId).toBe("test-session");
    });

    it("should preserve existing log entries when completing task", async () => {
      // Arrange
      const ctx = createPRToolContext(testDb);
      const issue = createTestIssue(ctx.issueRepository, { title: "Test Issue" });
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Add an existing log entry
      const db = testDb.db as DbType;
      db.insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task.id,
          sessionId: "test-session",
          message: "Started implementation",
          filesModified: null,
          createdAt: new Date().toISOString(),
        })
        .run();

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Completed all work",
      });

      // Assert
      expect(result.isError).toBeFalsy();

      // Verify both log entries exist
      const logs = db
        .select()
        .from(taskExecutionLogs)
        .where(eq(taskExecutionLogs.taskId, task.id))
        .all();

      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.message)).toContain("Started implementation");
      expect(logs.map((l) => l.message)).toContain("Completed all work");
    });
  });
});

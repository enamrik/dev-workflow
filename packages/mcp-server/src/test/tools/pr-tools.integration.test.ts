/**
 * PR Tools Integration Tests
 *
 * Tests PR-related MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import {
  createClientForProject,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../helpers.js";
import {
  MockGitHubCLI,
  MockGitWorktreeService,
  TaskSyncService,
  taskExecutionLogs,
  type ProjectManagementProvider,
  type Project,
  IssueService,
  TaskService,
  PlanService,
  type DbClient,
} from "@dev-workflow/core";
import {
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
  type PRToolContext,
} from "../../tools/pr-tools.js";

const TEST_PROJECT_ID = "test-project-pr";

/**
 * Create a minimal mock provider for testing
 */
function createLocalMockProvider(): ProjectManagementProvider {
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
    closeIssueByTask: async () => {},
    reopenIssue: async () => {},
    getIssue: async () => null,
    searchIssues: async () => [],
    ensureLabelsExist: async () => {},
    addToProject: async () => ({ success: true, itemId: "mock_item" }),
    moveToColumn: async () => {},
    checkProject: async () => true,
    getProjectDetails: async () => null,
    getProjectStatusField: async () => null,
    getProjectFields: async () => [],
    setProjectItemField: async () => ({ success: true }),
    clearProjectItemField: async () => ({ success: true }),
    getAvailableLabels: async () => ({ supported: true, labels: [] }),
    linkParentChild: async () => {},
    addComment: async () => {},
    assignIssue: async () => {},
  };
}

/**
 * Create a test project for PRToolContext
 */
function createTestProject(): Project {
  return {
    id: TEST_PROJECT_ID,
    name: "Test Project",
    slug: "test-project-pr",
    gitRootHash: "test-hash-123",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    githubSync: null,
    isArchived: false,
    archivedAt: null,
  };
}

/**
 * Create a PRToolContext for testing
 */
async function createPRToolContext(
  testDb: TestDatabase,
  mockGitHubCLI?: MockGitHubCLI,
  mockGitWorktreeService?: MockGitWorktreeService
): Promise<{ ctx: PRToolContext; client: DbClient }> {
  // Create project first
  const project = await testDb.source.projects.create({
    gitRootHash: TEST_PROJECT_ID,
    name: "Test Project",
  });

  const client = createClientForProject(testDb, project.id);

  const githubCLI = mockGitHubCLI ?? new MockGitHubCLI();
  const gitWorktreeService = mockGitWorktreeService ?? new MockGitWorktreeService();
  const mockProvider = createLocalMockProvider();

  const taskSyncService = new TaskSyncService(testDb.source, mockProvider, project.id);

  // Create services with DbClient
  const planService = new PlanService(client);
  const taskService = new TaskService(client, mockProvider, gitWorktreeService);
  const issueService = new IssueService(client, taskService, mockProvider);

  return {
    ctx: {
      project: { ...createTestProject(), id: project.id },
      githubCLI,
      issueService,
      planService,
      taskService,
      gitWorktreeService,
      taskSyncService,
      db: client,
    },
    client,
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Implement feature",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
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
      const updatedTask = client.tasks.findById(task.id);
      expect(updatedTask?.status).toBe("IN_PROGRESS");
      expect(updatedTask?.prNumber).toBeDefined();
    });

    it("should use plain title when task has no GitHub issue", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Update feature",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Implement feature",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-implement-feature",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updateGitHubSync(task.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updateGitHubSync(task.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Regular Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Regular task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-regular-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Set GitHub sync for BOTH task and parent issue (but parent is NOT imported)
      client.tasks.updateGitHubSync(task.id, {
        githubIssueNumber: 101,
        githubUrl: "https://github.com/test/repo/issues/101",
        githubNodeId: "I_test_101",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      client.issues.update(issue.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, {
        title: "Imported Issue",
      });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Sub-issue task",
        description: "Task description",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-sub-issue-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });

      // Set GitHub sync for BOTH task and parent issue, AND mark parent as imported
      client.tasks.updateGitHubSync(task.id, {
        githubIssueNumber: 201,
        githubUrl: "https://github.com/test/repo/issues/201",
        githubNodeId: "I_test_201",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      client.issues.update(issue.id, {
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "READY", // Not IN_PROGRESS
      });

      client.tasks.update(task.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "READY", // Not IN_PROGRESS
      });

      client.tasks.update(task.id, {
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/123", 123, "OPEN");

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
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Set up task with branch and existing PR
      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Act
      const result = await handleSubmitForReview(ctx, { taskId: task.id });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("PR_REVIEW");

      // Verify task status changed in DB
      const updatedTask = client.tasks.findById(task.id);
      expect(updatedTask?.status).toBe("PR_REVIEW");
    });

    it("should NOT create a PR - only change status", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test",
        worktreePath: "/tmp/worktree",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(testDb, mockGitHubCLI);

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(testDb, mockGitHubCLI);

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "PR_REVIEW", // Already in PR_REVIEW
      });

      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

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

      // Create a project with GitHub sync enabled (including projectId)
      const project = await testDb.source.projects.create({
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

      // Create client scoped to this project
      const client = createClientForProject(testDb, project.id);

      // Create a mock provider that tracks calls using vitest spies
      const moveToColumnMock = vi.fn().mockResolvedValue(undefined);
      const mockProvider: ProjectManagementProvider = {
        ...createLocalMockProvider(),
        moveToColumn: moveToColumnMock,
      };
      const taskSyncService = new TaskSyncService(testDb.source, mockProvider, project.id);

      // Create services with DbClient
      const planService = new PlanService(client);
      const taskService = new TaskService(client, mockProvider, mockGitWorktreeService);
      const issueService = new IssueService(client, taskService, mockProvider);

      const ctx: PRToolContext = {
        project,
        githubCLI: mockGitHubCLI,
        issueService,
        planService,
        taskService,
        gitWorktreeService: mockGitWorktreeService,
        taskSyncService,
        db: client,
      };

      // Create issue, plan, and task
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Set up task with branch, worktree, PR, and GitHub sync (including projectItemId)
      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");
      client.tasks.updateGitHubSync(task.id, {
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
    const { ctx, client } = await createPRToolContext(
      testDb,
      mockGitHubCLI,
      mockGitWorktreeService
    );

    const issue = createTestIssue(client.issues, { title: "Test Issue" });
    const plan = createTestPlan(client.plans, issue.id);
    const task = createTestTask(client.tasks, plan.id, {
      title: "Implement feature",
      status: "IN_PROGRESS",
    });

    client.tasks.update(task.id, {
      branchName: "issue-1/task-1-implement-feature",
      worktreePath: "/tmp/worktree/issue-1-task-1",
    });

    // Step 1: Create PR
    const createResult = await handleCreatePR(ctx, { taskId: task.id });
    expect(createResult.isError).toBeFalsy();

    // Verify status is still IN_PROGRESS after create_pr
    const taskAfterCreate = client.tasks.findById(task.id);
    expect(taskAfterCreate?.status).toBe("IN_PROGRESS");
    expect(taskAfterCreate?.prNumber).toBeDefined();

    // Step 2: Submit for review
    const submitResult = await handleSubmitForReview(ctx, { taskId: task.id });
    expect(submitResult.isError).toBeFalsy();

    // Verify status is now PR_REVIEW
    const taskAfterSubmit = client.tasks.findById(task.id);
    expect(taskAfterSubmit?.status).toBe("PR_REVIEW");
  });

  it("should allow delayed submit_for_review (PR created earlier)", async () => {
    // Arrange
    const mockGitHubCLI = new MockGitHubCLI();
    const mockGitWorktreeService = new MockGitWorktreeService();
    const { ctx, client } = await createPRToolContext(
      testDb,
      mockGitHubCLI,
      mockGitWorktreeService
    );

    const issue = createTestIssue(client.issues, { title: "Test Issue" });
    const plan = createTestPlan(client.plans, issue.id);
    const task = createTestTask(client.tasks, plan.id, {
      title: "Implement feature",
      status: "IN_PROGRESS",
    });

    client.tasks.update(task.id, {
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

  describe("autoCloseIssue behavior", () => {
    it("should return allTasksComplete=true when completing the final task", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create two tasks - first is COMPLETED, second is IN_PROGRESS (will be completed)
      createTestTask(client.tasks, plan.id, {
        title: "First task",
        status: "COMPLETED",
      });
      const task2 = createTestTask(client.tasks, plan.id, {
        title: "Second task",
        status: "IN_PROGRESS",
      });
      // No branch = main mode

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: task2.id,
        sessionId: "test-session",
        finalLogEntry: "Completed second task",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.allTasksComplete).toBe(true);
      expect(content.issueClosed).toBe(false); // Not auto-closed since autoCloseIssue was false
      expect(content.issueNumber).toBe(issue.number);
    });

    it("should return allTasksComplete=false when tasks remain", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create two tasks - first is IN_PROGRESS (will be completed), second is READY
      const taskToComplete = createTestTask(client.tasks, plan.id, {
        title: "First task",
        status: "IN_PROGRESS",
      });
      createTestTask(client.tasks, plan.id, {
        title: "Second task",
        status: "READY",
      });

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: taskToComplete.id,
        sessionId: "test-session",
        finalLogEntry: "Completed first task",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.allTasksComplete).toBe(false);
      expect(content.issueClosed).toBe(false);
    });

    it("should auto-close issue when autoCloseIssue=true and all tasks complete", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue", status: "OPEN" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create single task
      const task = createTestTask(client.tasks, plan.id, {
        title: "Only task",
        status: "IN_PROGRESS",
      });

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Completed only task",
        autoCloseIssue: true,
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.allTasksComplete).toBe(true);
      expect(content.issueClosed).toBe(true);
      expect(content.message).toContain("has been closed");

      // Verify issue was actually closed in DB
      const updatedIssue = client.issues.findById(issue.id);
      expect(updatedIssue?.status).toBe("CLOSED");
    });

    it("should NOT auto-close issue when autoCloseIssue=true but tasks remain", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue", status: "OPEN" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create two tasks
      const taskToComplete = createTestTask(client.tasks, plan.id, {
        title: "First task",
        status: "IN_PROGRESS",
      });
      createTestTask(client.tasks, plan.id, {
        title: "Second task",
        status: "READY",
      });

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: taskToComplete.id,
        sessionId: "test-session",
        finalLogEntry: "Completed first task",
        autoCloseIssue: true,
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.allTasksComplete).toBe(false);
      expect(content.issueClosed).toBe(false);

      // Verify issue is still open
      const updatedIssue = client.issues.findById(issue.id);
      expect(updatedIssue?.status).toBe("OPEN");
    });

    it("should count ABANDONED tasks as terminal for allTasksComplete", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create two tasks - first is ABANDONED, second is IN_PROGRESS (will be completed)
      createTestTask(client.tasks, plan.id, {
        title: "Abandoned task",
        status: "ABANDONED",
      });
      const taskToComplete = createTestTask(client.tasks, plan.id, {
        title: "Final task",
        status: "IN_PROGRESS",
      });

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: taskToComplete.id,
        sessionId: "test-session",
        finalLogEntry: "Completed final task",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.allTasksComplete).toBe(true);
    });

    it("should exclude deleted tasks from allTasksComplete calculation", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);

      // Create two tasks - first is READY but deleted, second is IN_PROGRESS
      const deletedTask = createTestTask(client.tasks, plan.id, {
        title: "Deleted task",
        status: "READY",
      });
      client.tasks.softDelete(deletedTask.id, "test-user");

      const taskToComplete = createTestTask(client.tasks, plan.id, {
        title: "Only active task",
        status: "IN_PROGRESS",
      });

      // Act
      const result = await handleCompleteTask(ctx, {
        taskId: taskToComplete.id,
        sessionId: "test-session",
        finalLogEntry: "Completed task",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.allTasksComplete).toBe(true); // Only active task matters
    });
  });

  describe("finalLogEntry requirement", () => {
    it("should fail if finalLogEntry is not provided", async () => {
      // Arrange
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
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
      const db = testDb.db;
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
      const { ctx, client } = await createPRToolContext(testDb);
      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS",
      });

      // Add an existing log entry
      const db = testDb.db;
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

  describe("force mode behavior", () => {
    it("should fail with force=true when PR is confirmed unmerged", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "PR_REVIEW",
      });

      // Set up task with branch, worktree, and PR
      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Configure mock to return an unmerged PR
      mockGitHubCLI.setPRStatus(42, { merged: false, state: "open" });

      // Act - try to force complete with unmerged PR
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Attempted force complete",
        force: true,
      });

      // Assert - should fail even with force=true
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not merged yet");
      expect(result.content[0].text).toContain("force=true cannot bypass");

      // Verify task was NOT completed
      const updatedTask = client.tasks.findById(task.id);
      expect(updatedTask?.status).toBe("PR_REVIEW");
    });

    it("should succeed with force=true when PR is not found on GitHub", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "PR_REVIEW",
      });

      // Set up task with branch, worktree, and PR
      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Configure mock to return null (PR not found)
      mockGitHubCLI.setPRStatus(42, null);

      // Act - force complete when PR is not found
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Force completed with PR not found",
        force: true,
      });

      // Assert - should succeed with force=true when PR is not found
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("COMPLETED");
    });

    it("should succeed with force=true when task is in wrong status", async () => {
      // Arrange
      const mockGitHubCLI = new MockGitHubCLI();
      const mockGitWorktreeService = new MockGitWorktreeService();
      const { ctx, client } = await createPRToolContext(
        testDb,
        mockGitHubCLI,
        mockGitWorktreeService
      );

      const issue = createTestIssue(client.issues, { title: "Test Issue" });
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test task",
        status: "IN_PROGRESS", // Wrong status for completion
      });

      // Set up task with branch, worktree, and PR
      client.tasks.update(task.id, {
        branchName: "issue-1/task-1-test-task",
        worktreePath: "/tmp/worktree/issue-1-task-1",
      });
      client.tasks.updatePRInfo(task.id, "https://github.com/test/repo/pull/42", 42, "OPEN");

      // Configure mock to return a merged PR
      mockGitHubCLI.setPRStatus(42, { merged: true, state: "closed" });

      // Act - force complete with wrong status but merged PR
      const result = await handleCompleteTask(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        finalLogEntry: "Force completed from wrong status",
        force: true,
      });

      // Assert - should succeed because PR is merged
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("COMPLETED");
    });
  });
});

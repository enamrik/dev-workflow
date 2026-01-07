/**
 * Task Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../helpers.js";
import {
  TaskSessionService,
  TaskManagementService,
  ConflictDetectionService,
  MockGitWorktreeService,
  SqliteProjectRepository,
  TaskGitHubSyncService,
  taskExecutionLogs,
  type ProjectManagementProvider,
} from "@dev-workflow/core";
import {
  handleGetTask,
  handleListAvailableTasks,
  handleUpdateTask,
  handleLogTaskProgress,
  handleGetTaskExecutionLog,
  handleLoadTaskSession,
  type TaskToolContext,
} from "../../tools/task-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

type DbType = BetterSQLite3Database<typeof schema>;

/**
 * Tracking for mock provider calls
 */
interface MockProviderCalls {
  assignIssue: Array<{ issueRef: string; assignee: string }>;
}

/**
 * Create a minimal mock provider for testing
 */
function createMockProvider(calls?: MockProviderCalls): ProjectManagementProvider {
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
    getProjectFields: async () => [],
    setProjectItemField: async () => ({ success: true }),
    clearProjectItemField: async () => ({ success: true }),
    linkParentChild: async () => {},
    addComment: async () => {},
    assignIssue: async (issueRef: string, assignee: string) => {
      if (calls) {
        calls.assignIssue.push({ issueRef, assignee });
      }
    },
  };
}

/**
 * Extended context for testing that includes projectRepository
 */
interface TestTaskToolContext extends TaskToolContext {
  projectRepository: SqliteProjectRepository;
  projectId: string;
}

/**
 * Create a TaskToolContext for testing
 *
 * @param testDb - The test database
 * @param options - Options including mock provider calls and GitHub sync config
 */
function createTaskToolContext(
  testDb: TestDatabase,
  options?: {
    mockProviderCalls?: MockProviderCalls;
    githubSync?: {
      enabled: boolean;
      assignee?: string;
    };
  }
): TestTaskToolContext {
  const db = testDb.db as DbType;
  const projectRepository = new SqliteProjectRepository(db);

  // Create project first with optional GitHub sync config
  const project = projectRepository.create({
    name: "Test Project",
    gitRootHash: "test-hash-" + crypto.randomUUID().slice(0, 8),
    githubSync: options?.githubSync ?? null,
  });

  const projectId = project.id;
  const repos = createRepositories(testDb.db, projectId);

  // Mock services
  const mockGitWorktreeService = new MockGitWorktreeService();
  const mockProvider = createMockProvider(options?.mockProviderCalls);

  const conflictDetectionService = new ConflictDetectionService(db, repos.taskRepository);

  const taskSessionService = new TaskSessionService(
    repos.taskRepository,
    repos.planRepository,
    repos.issueRepository,
    mockGitWorktreeService,
    conflictDetectionService,
    projectId
  );

  const taskManagementService = new TaskManagementService(
    repos.taskRepository,
    repos.planRepository,
    repos.issueRepository
  );

  const taskGitHubSyncService = new TaskGitHubSyncService(
    repos.taskRepository,
    repos.issueRepository,
    repos.planRepository,
    mockProvider,
    projectRepository,
    projectId
  );

  return {
    dbService: { getDb: () => db } as any,
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    taskSessionService,
    taskManagementService,
    taskExecutionLogsSchema: taskExecutionLogs,
    conflictDetectionService,
    taskGitHubSyncService,
    projectRepository,
    projectId,
  };
}

describe("Task Tools Integration", () => {
  let testDb: TestDatabase;
  let ctx: TaskToolContext;

  beforeEach(() => {
    testDb = createTestDatabase();
    ctx = createTaskToolContext(testDb);
  });

  describe("handleGetTask", () => {
    it("should get task by ID", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // handleGetTask returns task fields directly (not wrapped in task object)
      expect(content.title).toBe("Test Task");
      expect(content.status).toBe("BACKLOG");
    });

    it("should get task by issue and task number", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      createTestTask(ctx.taskRepository, plan.id, { title: "First Task" });

      const result = handleGetTask(ctx, {
        issueNumber: issue.number,
        taskNumber: 1,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.title).toBe("First Task");
    });

    it("should return error for non-existent task", () => {
      const result = handleGetTask(ctx, { taskId: "non-existent-id" });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return stored task number", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task1 = createTestTask(ctx.taskRepository, plan.id, { title: "Task 1" });
      const task2 = createTestTask(ctx.taskRepository, plan.id, { title: "Task 2" });

      const result1 = handleGetTask(ctx, { taskId: task1.id });
      const result2 = handleGetTask(ctx, { taskId: task2.id });

      const content1 = JSON.parse(result1.content[0].text);
      const content2 = JSON.parse(result2.content[0].text);

      expect(content1.number).toBe(1);
      expect(content2.number).toBe(2);
    });

    it("should find task by stored number", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 1" });
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 2" });

      const result = handleGetTask(ctx, {
        issueNumber: issue.number,
        taskNumber: 2,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.title).toBe("Task 2");
      expect(content.number).toBe(2);
    });
  });

  describe("handleListAvailableTasks", () => {
    it("should list available tasks", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 1", status: "BACKLOG" });
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 2", status: "READY" });
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 3", status: "IN_PROGRESS" });

      const result = await handleListAvailableTasks(ctx, {});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // Only BACKLOG and READY tasks are available
      expect(content.tasks.length).toBe(2);
    });

    it("should filter by issue number", async () => {
      const issue1 = createTestIssue(ctx.issueRepository, { title: "Issue 1" });
      const issue2 = createTestIssue(ctx.issueRepository, { title: "Issue 2" });
      const plan1 = createTestPlan(ctx.planRepository, issue1.id);
      const plan2 = createTestPlan(ctx.planRepository, issue2.id);
      createTestTask(ctx.taskRepository, plan1.id, { title: "Task A", status: "BACKLOG" });
      createTestTask(ctx.taskRepository, plan2.id, { title: "Task B", status: "BACKLOG" });

      const result = await handleListAvailableTasks(ctx, {
        issueNumber: issue1.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasks.length).toBe(1);
      expect(content.tasks[0].title).toBe("Task A");
    });

    it("should return stored task numbers", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 1", status: "BACKLOG" });
      createTestTask(ctx.taskRepository, plan.id, { title: "Task 2", status: "BACKLOG" });

      const result = await handleListAvailableTasks(ctx, { issueNumber: issue.number });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasks.length).toBe(2);
      expect(content.tasks[0].number).toBe(1);
      expect(content.tasks[0].title).toBe("Task 1");
      expect(content.tasks[1].number).toBe(2);
      expect(content.tasks[1].title).toBe("Task 2");
    });
  });

  describe("handleUpdateTask", () => {
    it("should update task properties", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Original Title",
      });

      const result = await handleUpdateTask(ctx, {
        taskId: task.id,
        title: "Updated Title",
        description: "New description",
        estimatedMinutes: 60,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.title).toBe("Updated Title");

      // Verify database state
      const updated = ctx.taskRepository.findById(task.id);
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.description).toBe("New description");
      expect(updated!.estimatedMinutes).toBe(60);
    });
  });

  describe("handleLogTaskProgress and handleGetTaskExecutionLog", () => {
    it("should log and retrieve task progress", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id);

      // Log progress
      const logResult = handleLogTaskProgress(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        message: "Started implementation",
        filesModified: ["src/file1.ts", "src/file2.ts"],
      });

      expect(logResult.isError).toBeUndefined();

      // Retrieve log
      const getResult = handleGetTaskExecutionLog(ctx, { taskId: task.id });

      expect(getResult.isError).toBeUndefined();
      const content = JSON.parse(getResult.content[0].text);
      expect(content.entries.length).toBe(1);
      expect(content.entries[0].message).toBe("Started implementation");
      expect(content.entries[0].filesModified).toEqual(["src/file1.ts", "src/file2.ts"]);
    });
  });

  describe("handleLoadTaskSession - auto-assignment", () => {
    it("should auto-assign GitHub issue when assignee is configured", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssue: [] };
      const testDbWithAssignee = createTestDatabase();
      const ctxWithAssignee = createTaskToolContext(testDbWithAssignee, {
        mockProviderCalls: mockCalls,
        githubSync: {
          enabled: true,
          assignee: "testuser",
        },
      });

      // Create task with GitHub sync info
      const issue = createTestIssue(ctxWithAssignee.issueRepository);
      const plan = createTestPlan(ctxWithAssignee.planRepository, issue.id);
      const task = createTestTask(ctxWithAssignee.taskRepository, plan.id, {
        title: "Task with GitHub",
        status: "BACKLOG",
      });

      // Add GitHub sync state to the task
      ctxWithAssignee.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Start the task
      const result = await handleLoadTaskSession(ctxWithAssignee, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main", // Use main mode to skip worktree creation
      });

      expect(result.isError).toBeUndefined();

      // Verify assignIssue was called with correct parameters
      expect(mockCalls.assignIssue.length).toBe(1);
      expect(mockCalls.assignIssue[0]).toEqual({
        issueRef: "42",
        assignee: "testuser",
      });
    });

    it("should not assign when no assignee is configured", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssue: [] };
      const testDbNoAssignee = createTestDatabase();
      const ctxNoAssignee = createTaskToolContext(testDbNoAssignee, {
        mockProviderCalls: mockCalls,
        githubSync: {
          enabled: true,
          // No assignee configured
        },
      });

      // Create task with GitHub sync info
      const issue = createTestIssue(ctxNoAssignee.issueRepository);
      const plan = createTestPlan(ctxNoAssignee.planRepository, issue.id);
      const task = createTestTask(ctxNoAssignee.taskRepository, plan.id, {
        title: "Task with GitHub",
        status: "BACKLOG",
      });

      // Add GitHub sync state to the task
      ctxNoAssignee.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Start the task
      const result = await handleLoadTaskSession(ctxNoAssignee, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      expect(result.isError).toBeUndefined();

      // Verify assignIssue was NOT called
      expect(mockCalls.assignIssue.length).toBe(0);
    });

    it("should not assign when GitHub sync is disabled", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssue: [] };
      const testDbDisabled = createTestDatabase();
      // No githubSync option - sync is disabled by default
      const ctxDisabled = createTaskToolContext(testDbDisabled, {
        mockProviderCalls: mockCalls,
      });

      // Create task with GitHub sync info (simulating a previously synced task)
      const issue = createTestIssue(ctxDisabled.issueRepository);
      const plan = createTestPlan(ctxDisabled.planRepository, issue.id);
      const task = createTestTask(ctxDisabled.taskRepository, plan.id, {
        title: "Task with GitHub",
        status: "BACKLOG",
      });

      // Add GitHub sync state to the task
      ctxDisabled.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Start the task
      const result = await handleLoadTaskSession(ctxDisabled, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      expect(result.isError).toBeUndefined();

      // Verify assignIssue was NOT called (sync is disabled)
      expect(mockCalls.assignIssue.length).toBe(0);
    });

    it("should not assign when task has no GitHub issue linked", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssue: [] };
      const testDbNoSync = createTestDatabase();
      const ctxNoSync = createTaskToolContext(testDbNoSync, {
        mockProviderCalls: mockCalls,
        githubSync: {
          enabled: true,
          assignee: "testuser",
        },
      });

      // Create task WITHOUT GitHub sync info
      const issue = createTestIssue(ctxNoSync.issueRepository);
      const plan = createTestPlan(ctxNoSync.planRepository, issue.id);
      const task = createTestTask(ctxNoSync.taskRepository, plan.id, {
        title: "Task without GitHub",
        status: "BACKLOG",
      });

      // Don't add GitHub sync state - task has no linked GitHub issue

      // Start the task
      const result = await handleLoadTaskSession(ctxNoSync, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      expect(result.isError).toBeUndefined();

      // Verify assignIssue was NOT called (no GitHub issue linked)
      expect(mockCalls.assignIssue.length).toBe(0);
    });
  });
});

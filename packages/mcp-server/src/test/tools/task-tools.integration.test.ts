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
    getAvailableLabels: async () => ({ supported: true, labels: [] }),
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
async function createTaskToolContext(
  testDb: TestDatabase,
  options?: {
    mockProviderCalls?: MockProviderCalls;
    githubSync?: {
      enabled: boolean;
      assignee?: string;
    };
  }
): Promise<TestTaskToolContext> {
  const db = testDb.db as DbType;
  const projectRepository = new SqliteProjectRepository(db);

  // Create project first with optional GitHub sync config
  const project = await projectRepository.create({
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

  beforeEach(async () => {
    testDb = createTestDatabase();
    ctx = await createTaskToolContext(testDb);
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

    it("should return task labels and type", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with labels",
        type: "FEATURE",
        labels: { priority: "high", sprint: "sprint-1" },
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.type).toBe("FEATURE");
      expect(content.labels).toEqual({ priority: "high", sprint: "sprint-1" });
    });

    it("should return workerInfo when task is IN_PROGRESS with session", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task in progress",
        status: "IN_PROGRESS",
      });

      // Simulate a task with sessionId (as would happen during load_task_session)
      ctx.taskRepository.update(task.id, { sessionId: "test-session-123" });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("IN_PROGRESS");
      expect(content.workerInfo).toBeDefined();
      expect(content.workerInfo.sessionId).toBe("test-session-123");
      // workerId will be null since no dispatch queue entry
      expect(content.workerInfo.workerId).toBeNull();
    });

    it("should not return workerInfo when task is not IN_PROGRESS", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task in backlog",
        status: "BACKLOG",
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("BACKLOG");
      expect(content.workerInfo).toBeUndefined();
    });

    it("should return prInfo when task has a PR", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with PR",
        status: "PR_REVIEW",
      });

      // Simulate a task with PR info
      ctx.taskRepository.update(task.id, {
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
        prStatus: "OPEN",
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeDefined();
      expect(content.prInfo.prNumber).toBe(42);
      expect(content.prInfo.prUrl).toBe("https://github.com/test/repo/pull/42");
      expect(content.prInfo.prStatus).toBe("OPEN");
    });

    it("should not return prInfo when task has no PR", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task without PR",
        status: "IN_PROGRESS",
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeUndefined();
    });

    it("should return both workerInfo and prInfo when applicable", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with worker and PR",
        status: "IN_PROGRESS",
      });

      // Simulate a task with both session and PR info
      ctx.taskRepository.update(task.id, {
        sessionId: "session-456",
        prNumber: 99,
        prUrl: "https://github.com/test/repo/pull/99",
        prStatus: "DRAFT",
      });

      const result = handleGetTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.workerInfo).toBeDefined();
      expect(content.workerInfo.sessionId).toBe("session-456");

      expect(content.prInfo).toBeDefined();
      expect(content.prInfo.prNumber).toBe(99);
      expect(content.prInfo.prStatus).toBe("DRAFT");
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

    it("should add labels to a task", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task without labels",
      });

      const result = await handleUpdateTask(ctx, {
        taskId: task.id,
        labels: {
          priority: "high",
          sprint: "sprint-1",
          urgent: "", // Simple tag (empty value)
        },
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        priority: "high",
        sprint: "sprint-1",
        urgent: "",
      });

      // Verify database state
      const updated = ctx.taskRepository.findById(task.id);
      expect(updated!.labels).toEqual({
        priority: "high",
        sprint: "sprint-1",
        urgent: "",
      });
    });

    it("should merge labels with existing ones", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with labels",
        labels: { existing: "value", toUpdate: "old" },
      });

      const result = await handleUpdateTask(ctx, {
        taskId: task.id,
        labels: {
          toUpdate: "new", // Update existing
          newLabel: "added", // Add new
        },
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        existing: "value", // Preserved
        toUpdate: "new", // Updated
        newLabel: "added", // Added
      });
    });

    it("should remove labels when value is null", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with labels",
        labels: { keep: "value", remove: "gone" },
      });

      const result = await handleUpdateTask(ctx, {
        taskId: task.id,
        labels: {
          remove: null, // Remove this label
        },
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        keep: "value", // Preserved
        // 'remove' is gone
      });

      // Verify database state
      const updated = ctx.taskRepository.findById(task.id);
      expect(updated!.labels).toEqual({ keep: "value" });
    });

    it("should clear all labels when all are removed", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Task with labels",
        labels: { only: "label" },
      });

      const result = await handleUpdateTask(ctx, {
        taskId: task.id,
        labels: {
          only: null, // Remove the only label
        },
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // When all labels removed, should be undefined/null
      expect(content.task.labels).toBeUndefined();

      // Verify database state
      const updated = ctx.taskRepository.findById(task.id);
      expect(updated!.labels).toBeUndefined();
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
      const ctxWithAssignee = await createTaskToolContext(testDbWithAssignee, {
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
      const ctxNoAssignee = await createTaskToolContext(testDbNoAssignee, {
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
      const ctxDisabled = await createTaskToolContext(testDbDisabled, {
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
      const ctxNoSync = await createTaskToolContext(testDbNoSync, {
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

  describe("handleLoadTaskSession - claiming rules", () => {
    it("should reject queued task without workerId", async () => {
      const testDbQueue = createTestDatabase();
      const ctxQueue = await createTaskToolContext(testDbQueue);
      const repos = createRepositories(testDbQueue.db);

      // Create task
      const issue = createTestIssue(ctxQueue.issueRepository);
      const plan = createTestPlan(ctxQueue.planRepository, issue.id);
      const task = createTestTask(ctxQueue.taskRepository, plan.id, {
        title: "Queued Task",
        status: "BACKLOG",
      });

      // Add task to dispatch queue
      repos.dispatchQueueRepository.enqueue(task.id);

      // Add dispatch queue to context
      const ctxWithQueue = {
        ...ctxQueue,
        dispatchQueueRepository: repos.dispatchQueueRepository,
      };

      // Try to start without workerId
      const result = await handleLoadTaskSession(ctxWithQueue, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      // Should fail with error about needing a worker
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("dispatch queue");
      expect(content.error).toContain("worker");
    });

    it("should allow worker to claim queued task", async () => {
      const testDbQueue = createTestDatabase();
      const ctxQueue = await createTaskToolContext(testDbQueue);
      const repos = createRepositories(testDbQueue.db);

      // Create task
      const issue = createTestIssue(ctxQueue.issueRepository);
      const plan = createTestPlan(ctxQueue.planRepository, issue.id);
      const task = createTestTask(ctxQueue.taskRepository, plan.id, {
        title: "Queued Task",
        status: "BACKLOG",
      });

      // Add task to dispatch queue
      repos.dispatchQueueRepository.enqueue(task.id);

      // Add dispatch queue to context
      const ctxWithQueue = {
        ...ctxQueue,
        dispatchQueueRepository: repos.dispatchQueueRepository,
      };

      // Start with workerId (isolated mode is enforced for workers)
      const result = await handleLoadTaskSession(ctxWithQueue, {
        taskId: task.id,
        sessionId: "test-session",
        workerId: "test-worker-id",
        // mode defaults to "isolated"
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(true);
    });

    it("should resume non-queued IN_PROGRESS task by any session", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "In Progress Task",
        status: "IN_PROGRESS",
      });

      // Update task with session info (as if started by another session)
      ctx.taskRepository.update(task.id, { sessionId: "original-session" });

      // Resume with different session
      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "new-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(true);
    });

    it("should resume non-queued PR_REVIEW task by any session", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      // Create task directly in PR_REVIEW status (bypassing state machine)
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "PR Review Task",
        status: "PR_REVIEW",
      });

      // Resume with new session
      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "new-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(true);
      expect(content.task.status).toBe("PR_REVIEW");
    });

    it("should reject COMPLETED task", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      // Create task directly in COMPLETED status (bypassing state machine)
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Completed Task",
        status: "COMPLETED",
      });

      // Try to start
      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "new-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("COMPLETED");
    });

    it("should reject ABANDONED task", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      // Create task directly in ABANDONED status (bypassing state machine)
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Abandoned Task",
        status: "ABANDONED",
      });

      // Try to start
      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "new-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("ABANDONED");
    });

    it("should start fresh for non-queued BACKLOG task", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Backlog Task",
        status: "BACKLOG",
      });

      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBeUndefined(); // Not resumed, fresh start
      expect(content.startedAt).toBeDefined();
      expect(content.task.status).toBe("IN_PROGRESS");
    });

    it("should start fresh for non-queued READY task", async () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);
      const task = createTestTask(ctx.taskRepository, plan.id, {
        title: "Ready Task",
        status: "READY",
      });

      const result = await handleLoadTaskSession(ctx, {
        taskId: task.id,
        sessionId: "test-session",
        mode: "main",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBeUndefined(); // Not resumed, fresh start
      expect(content.startedAt).toBeDefined();
      expect(content.task.status).toBe("IN_PROGRESS");
    });
  });
});

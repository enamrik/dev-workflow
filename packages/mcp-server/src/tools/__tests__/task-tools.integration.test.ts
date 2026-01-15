/**
 * Task Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../test/helpers.js";
import {
  TaskSessionService,
  TaskManagementService,
  ConflictDetectionService,
  MockGitWorktreeService,
  TaskSyncService,
  type ProjectManagementProvider,
  IssueService,
  TaskService,
  PlanService,
  GlobalDbWorkerQueueDb,
  type DbClient,
} from "@dev-workflow/core";
import {
  handleGetTask,
  handleListAvailableTasks,
  handleUpdateTask,
  handleLogTaskProgress,
  handleGetTaskExecutionLog,
  handleLoadTaskSession,
} from "../../tools/task-tool-def.js";
import { TaskTool } from "../../tools/task-tool.js";
import {
  GetTaskSchema,
  ListAvailableTasksSchema,
  UpdateTaskSchema,
  LogTaskProgressSchema,
  GetTaskExecutionLogSchema,
  LoadTaskSessionSchema,
  AbandonTaskSchema,
  DeleteTaskSchema,
  GetTaskExecutionPromptSchema,
  CheckTaskConflictsSchema,
} from "../../tools/schemas.js";

/**
 * Tracking for mock provider calls
 */
interface MockProviderCalls {
  assignIssueToConfiguredUser: Array<{ issueRef: string }>;
}

/**
 * Create a minimal mock provider for testing
 */
function createLocalMockProvider(
  calls?: MockProviderCalls,
  config?: { enabled?: boolean; assignee?: string }
): ProjectManagementProvider {
  const enabled = config?.enabled ?? true;
  const assignee = config?.assignee;

  return {
    providerId: "mock",
    displayName: "Mock Provider",
    // Configuration methods
    isEnabled: () => enabled,
    hasProjectBoard: () => false,
    getAssignee: () => assignee,
    getCustomLabels: () => [],
    getColumnForStatus: () => "Backlog",
    getProjectId: () => undefined,
    getLabelFieldMapping: () => undefined,
    // High-level operations
    moveItemToStatusColumn: async () => {},
    assignIssueToConfiguredUser: async (issueRef: string) => {
      // Only track calls if there's an assignee (like real provider behavior)
      if (calls && assignee) {
        calls.assignIssueToConfiguredUser.push({ issueRef });
      }
    },
    // Auth/Validation
    checkAuth: async () => ({ authenticated: true }),
    checkRepository: async () => ({ accessible: true }),
    // Issue operations
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
    // Project operations
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
 * Extended context type for testing
 */

type TestTaskToolContext = any;

/**
 * Create a TaskToolContext for testing
 *
 * @param testDb - The test database
 * @param workerQueueDb - Worker queue database for dispatch operations
 * @param options - Options including mock provider calls and GitHub sync config
 */
async function createTaskToolContext(
  testDb: TestDatabase,
  workerQueueDb: GlobalDbWorkerQueueDb,
  options?: {
    mockProviderCalls?: MockProviderCalls;
    githubSync?: {
      enabled: boolean;
      assignee?: string;
    };
  }
): Promise<{ ctx: TestTaskToolContext; client: DbClient }> {
  // Create project first with optional GitHub sync config
  const project = await testDb.source.projects.create({
    name: "Test Project",
    gitRootHash: "test-hash-" + crypto.randomUUID().slice(0, 8),
    githubSync: options?.githubSync ?? null,
  });

  const projectId = project.id;
  const client = createClientForProject(testDb, projectId);

  // Mock services
  const mockGitWorktreeService = new MockGitWorktreeService();
  const mockProvider = createLocalMockProvider(options?.mockProviderCalls, options?.githubSync);

  const conflictDetectionService = new ConflictDetectionService(client);

  const taskSessionService = new TaskSessionService(
    client,
    mockGitWorktreeService,
    conflictDetectionService
  );

  const taskManagementService = new TaskManagementService(client);

  const taskSyncService = new TaskSyncService(testDb.source, mockProvider, projectId);

  const planService = new PlanService(client);
  const taskService = new TaskService(client, mockProvider, mockGitWorktreeService);
  const issueService = new IssueService(client, taskService, mockProvider);

  // Create TaskTool with all dependencies
  const taskTool = new TaskTool(
    taskService,
    taskSessionService,
    taskManagementService,
    planService,
    issueService,
    client,
    workerQueueDb,
    taskSyncService,
    conflictDetectionService,
    null, // providerRegistry
    null, // project
    null, // dbSource
    null // githubCLI
  );

  return {
    ctx: {
      taskTool,
      dbClient: client,
      issueService,
      planService,
      taskService,
      workerQueueDb,
      taskSessionService,
      taskManagementService,
      conflictDetectionService,
      taskSyncService,
      projectId,
    },
    client,
  };
}

describe("Task Tools Integration", () => {
  let testDb: TestDatabase;

  let ctx: any;
  let client: DbClient;
  let workerQueueDbPath: string;
  let workerQueueDb: GlobalDbWorkerQueueDb;

  beforeEach(async () => {
    testDb = createTestDatabase();

    // Create a temporary worker queue database for testing
    workerQueueDbPath = path.join(
      os.tmpdir(),
      `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
    );
    workerQueueDb = new GlobalDbWorkerQueueDb(workerQueueDbPath);

    const result = await createTaskToolContext(testDb, workerQueueDb);
    ctx = result.ctx;
    client = result.client;
  });

  afterEach(() => {
    workerQueueDb.close();
    try {
      fs.unlinkSync(workerQueueDbPath);
    } catch {
      // Ignore cleanup errors
    }
    testDb.cleanup();
  });

  describe("handleGetTask", () => {
    it("should get task by ID", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // handleGetTask returns task fields directly (not wrapped in task object)
      expect(content.title).toBe("Test Task");
      expect(content.status).toBe("BACKLOG");
    });

    it("should get task by issue and task number", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      createTestTask(client.tasks, plan.id, { title: "First Task" });

      const result = await handleGetTask(
        {
          issueNumber: issue.number,
          taskNumber: 1,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.title).toBe("First Task");
    });

    it("should return error for non-existent task", async () => {
      const result = await handleGetTask({ taskId: "non-existent-id" }, ctx);

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return stored task number", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task1 = createTestTask(client.tasks, plan.id, { title: "Task 1" });
      const task2 = createTestTask(client.tasks, plan.id, { title: "Task 2" });

      const result1 = await handleGetTask({ taskId: task1.id }, ctx);
      const result2 = await handleGetTask({ taskId: task2.id }, ctx);

      const content1 = JSON.parse(result1.content[0].text);
      const content2 = JSON.parse(result2.content[0].text);

      expect(content1.number).toBe(1);
      expect(content2.number).toBe(2);
    });

    it("should find task by stored number", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      createTestTask(client.tasks, plan.id, { title: "Task 1" });
      createTestTask(client.tasks, plan.id, { title: "Task 2" });

      const result = await handleGetTask(
        {
          issueNumber: issue.number,
          taskNumber: 2,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.title).toBe("Task 2");
      expect(content.number).toBe(2);
    });

    it("should return task labels and type", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        type: "FEATURE",
        labels: { priority: "high", sprint: "sprint-1" },
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.type).toBe("FEATURE");
      expect(content.labels).toEqual({ priority: "high", sprint: "sprint-1" });
    });

    it("should return workerInfo when task is IN_PROGRESS with session", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task in progress",
        status: "IN_PROGRESS",
      });

      // Simulate a task with sessionId (as would happen during load_task_session)
      client.tasks.update(task.id, { sessionId: "test-session-123" });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("IN_PROGRESS");
      expect(content.workerInfo).toBeDefined();
      expect(content.workerInfo.sessionId).toBe("test-session-123");
      // workerId will be null since no dispatch queue entry
      expect(content.workerInfo.workerId).toBeNull();
    });

    it("should not return workerInfo when task is not IN_PROGRESS", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task in backlog",
        status: "BACKLOG",
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("BACKLOG");
      expect(content.workerInfo).toBeUndefined();
    });

    it("should return prInfo when task has a PR", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with PR",
        status: "PR_REVIEW",
      });

      // Simulate a task with PR info
      client.tasks.update(task.id, {
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
        prStatus: "OPEN",
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeDefined();
      expect(content.prInfo.prNumber).toBe(42);
      expect(content.prInfo.prUrl).toBe("https://github.com/test/repo/pull/42");
      expect(content.prInfo.prStatus).toBe("OPEN");
    });

    it("should not return prInfo when task has no PR", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task without PR",
        status: "IN_PROGRESS",
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeUndefined();
    });

    it("should return both workerInfo and prInfo when applicable", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with worker and PR",
        status: "IN_PROGRESS",
      });

      // Simulate a task with both session and PR info
      client.tasks.update(task.id, {
        sessionId: "session-456",
        prNumber: 99,
        prUrl: "https://github.com/test/repo/pull/99",
        prStatus: "DRAFT",
      });

      const result = await handleGetTask({ taskId: task.id }, ctx);

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
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      createTestTask(client.tasks, plan.id, { title: "Task 1", status: "BACKLOG" });
      createTestTask(client.tasks, plan.id, { title: "Task 2", status: "READY" });
      createTestTask(client.tasks, plan.id, { title: "Task 3", status: "IN_PROGRESS" });

      const result = await handleListAvailableTasks({}, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // Only BACKLOG and READY tasks are available
      expect(content.tasks.length).toBe(2);
    });

    it("should filter by issue number", async () => {
      const issue1 = createTestIssue(client.issues, { title: "Issue 1" });
      const issue2 = createTestIssue(client.issues, { title: "Issue 2" });
      const plan1 = createTestPlan(client.plans, issue1.id);
      const plan2 = createTestPlan(client.plans, issue2.id);
      createTestTask(client.tasks, plan1.id, { title: "Task A", status: "BACKLOG" });
      createTestTask(client.tasks, plan2.id, { title: "Task B", status: "BACKLOG" });

      const result = await handleListAvailableTasks(
        {
          issueNumber: issue1.number,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasks.length).toBe(1);
      expect(content.tasks[0].title).toBe("Task A");
    });

    it("should return stored task numbers", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      createTestTask(client.tasks, plan.id, { title: "Task 1", status: "BACKLOG" });
      createTestTask(client.tasks, plan.id, { title: "Task 2", status: "BACKLOG" });

      const result = await handleListAvailableTasks({ issueNumber: issue.number }, ctx);

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
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Original Title",
      });

      const result = await handleUpdateTask(
        {
          taskId: task.id,
          title: "Updated Title",
          description: "New description",
          estimatedMinutes: 60,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.title).toBe("Updated Title");

      // Verify database state
      const updated = client.tasks.findById(task.id);
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.description).toBe("New description");
      expect(updated!.estimatedMinutes).toBe(60);
    });

    it("should add labels to a task", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task without labels",
      });

      const result = await handleUpdateTask(
        {
          taskId: task.id,
          labels: {
            priority: "high",
            sprint: "sprint-1",
            urgent: "", // Simple tag (empty value)
          },
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        priority: "high",
        sprint: "sprint-1",
        urgent: "",
      });

      // Verify database state
      const updated = client.tasks.findById(task.id);
      expect(updated!.labels).toEqual({
        priority: "high",
        sprint: "sprint-1",
        urgent: "",
      });
    });

    it("should merge labels with existing ones", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { existing: "value", toUpdate: "old" },
      });

      const result = await handleUpdateTask(
        {
          taskId: task.id,
          labels: {
            toUpdate: "new", // Update existing
            newLabel: "added", // Add new
          },
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        existing: "value", // Preserved
        toUpdate: "new", // Updated
        newLabel: "added", // Added
      });
    });

    it("should remove labels when value is null", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { keep: "value", remove: "gone" },
      });

      const result = await handleUpdateTask(
        {
          taskId: task.id,
          labels: {
            remove: null, // Remove this label
          },
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.labels).toEqual({
        keep: "value", // Preserved
        // 'remove' is gone
      });

      // Verify database state
      const updated = client.tasks.findById(task.id);
      expect(updated!.labels).toEqual({ keep: "value" });
    });

    it("should clear all labels when all are removed", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { only: "label" },
      });

      const result = await handleUpdateTask(
        {
          taskId: task.id,
          labels: {
            only: null, // Remove the only label
          },
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // When all labels removed, should be undefined/null
      expect(content.task.labels).toBeUndefined();

      // Verify database state
      const updated = client.tasks.findById(task.id);
      expect(updated!.labels).toBeUndefined();
    });
  });

  describe("handleLogTaskProgress and handleGetTaskExecutionLog", () => {
    it("should log and retrieve task progress", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id);

      // Log progress
      const logResult = await handleLogTaskProgress(
        {
          taskId: task.id,
          sessionId: "test-session",
          message: "Started implementation",
          filesModified: ["src/file1.ts", "src/file2.ts"],
        },
        ctx
      );

      expect(logResult.isError).toBeUndefined();

      // Retrieve log
      const getResult = await handleGetTaskExecutionLog({ taskId: task.id }, ctx);

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
      const mockCalls: MockProviderCalls = { assignIssueToConfiguredUser: [] };
      const testDbWithAssignee = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        const { ctx: ctxWithAssignee, client: clientWithAssignee } = await createTaskToolContext(
          testDbWithAssignee,
          queueDb,
          {
            mockProviderCalls: mockCalls,
            githubSync: {
              enabled: true,
              assignee: "testuser",
            },
          }
        );

        // Create task with GitHub sync info
        const issue = createTestIssue(clientWithAssignee.issues);
        const plan = createTestPlan(clientWithAssignee.plans, issue.id);
        const task = createTestTask(clientWithAssignee.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        clientWithAssignee.tasks.updateGitHubSync(task.id, {
          githubIssueNumber: 42,
          githubUrl: "https://github.com/test/repo/issues/42",
          githubNodeId: "I_test_42",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        });

        // Start the task
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main", // Use main mode to skip worktree creation
          },
          ctxWithAssignee
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssueToConfiguredUser was called with correct parameters
        expect(mockCalls.assignIssueToConfiguredUser.length).toBe(1);
        expect(mockCalls.assignIssueToConfiguredUser[0]).toEqual({
          issueRef: "42",
        });
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbWithAssignee.cleanup();
      }
    });

    it("should not assign when no assignee is configured", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssueToConfiguredUser: [] };
      const testDbNoAssignee = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        const { ctx: ctxNoAssignee, client: clientNoAssignee } = await createTaskToolContext(
          testDbNoAssignee,
          queueDb,
          {
            mockProviderCalls: mockCalls,
            githubSync: {
              enabled: true,
              // No assignee configured
            },
          }
        );

        // Create task with GitHub sync info
        const issue = createTestIssue(clientNoAssignee.issues);
        const plan = createTestPlan(clientNoAssignee.plans, issue.id);
        const task = createTestTask(clientNoAssignee.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        clientNoAssignee.tasks.updateGitHubSync(task.id, {
          githubIssueNumber: 42,
          githubUrl: "https://github.com/test/repo/issues/42",
          githubNodeId: "I_test_42",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        });

        // Start the task
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxNoAssignee
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called
        expect(mockCalls.assignIssueToConfiguredUser.length).toBe(0);
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbNoAssignee.cleanup();
      }
    });

    it("should not assign when GitHub sync is disabled", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssueToConfiguredUser: [] };
      const testDbDisabled = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        // No githubSync option - sync is disabled by default
        const { ctx: ctxDisabled, client: clientDisabled } = await createTaskToolContext(
          testDbDisabled,
          queueDb,
          {
            mockProviderCalls: mockCalls,
          }
        );

        // Create task with GitHub sync info (simulating a previously synced task)
        const issue = createTestIssue(clientDisabled.issues);
        const plan = createTestPlan(clientDisabled.plans, issue.id);
        const task = createTestTask(clientDisabled.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        clientDisabled.tasks.updateGitHubSync(task.id, {
          githubIssueNumber: 42,
          githubUrl: "https://github.com/test/repo/issues/42",
          githubNodeId: "I_test_42",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        });

        // Start the task
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxDisabled
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called (sync is disabled)
        expect(mockCalls.assignIssueToConfiguredUser.length).toBe(0);
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbDisabled.cleanup();
      }
    });

    it("should not assign when task has no GitHub issue linked", async () => {
      // Track mock provider calls
      const mockCalls: MockProviderCalls = { assignIssueToConfiguredUser: [] };
      const testDbNoSync = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        const { ctx: ctxNoSync, client: clientNoSync } = await createTaskToolContext(
          testDbNoSync,
          queueDb,
          {
            mockProviderCalls: mockCalls,
            githubSync: {
              enabled: true,
              assignee: "testuser",
            },
          }
        );

        // Create task WITHOUT GitHub sync info
        const issue = createTestIssue(clientNoSync.issues);
        const plan = createTestPlan(clientNoSync.plans, issue.id);
        const task = createTestTask(clientNoSync.tasks, plan.id, {
          title: "Task without GitHub",
          status: "BACKLOG",
        });

        // Don't add GitHub sync state - task has no linked GitHub issue

        // Start the task
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxNoSync
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called (no GitHub issue linked)
        expect(mockCalls.assignIssueToConfiguredUser.length).toBe(0);
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbNoSync.cleanup();
      }
    });
  });

  describe("handleLoadTaskSession - claiming rules", () => {
    it("should reject queued task without workerId", async () => {
      const testDbQueue = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        const { ctx: ctxQueue, client: clientQueue } = await createTaskToolContext(
          testDbQueue,
          queueDb
        );

        // Create task
        const issue = createTestIssue(clientQueue.issues);
        const plan = createTestPlan(clientQueue.plans, issue.id);
        const task = createTestTask(clientQueue.tasks, plan.id, {
          title: "Queued Task",
          status: "BACKLOG",
        });

        // Add task to dispatch queue (uses workerQueueDb)
        queueDb.enqueue(task.id, "test-project");

        // Try to start without workerId
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxQueue
        );

        // Should fail with error about needing a worker
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("dispatch queue");
        expect(content.error).toContain("worker");
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbQueue.cleanup();
      }
    });

    it("should allow worker to claim queued task", async () => {
      const testDbQueue = createTestDatabase();
      const queueDbPath = path.join(
        os.tmpdir(),
        `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
      );
      const queueDb = new GlobalDbWorkerQueueDb(queueDbPath);

      try {
        const { ctx: ctxQueue, client: clientQueue } = await createTaskToolContext(
          testDbQueue,
          queueDb
        );

        // Create task
        const issue = createTestIssue(clientQueue.issues);
        const plan = createTestPlan(clientQueue.plans, issue.id);
        const task = createTestTask(clientQueue.tasks, plan.id, {
          title: "Queued Task",
          status: "BACKLOG",
        });

        // Register worker and add task to dispatch queue (uses workerQueueDb)
        const workerId = "test-worker-id";
        queueDb.registerWorker(workerId, "test-worker");
        queueDb.enqueue(task.id, "test-project");

        // Worker claims the task (simulating what worker-runner does)
        const claimed = queueDb.claimTask(workerId);
        expect(claimed).toBeTruthy();
        expect(claimed?.taskId).toBe(task.id);

        // Start with workerId (isolated mode is enforced for workers)
        const result = await handleLoadTaskSession(
          {
            taskId: task.id,
            sessionId: "test-session",
            workerId,
            // mode defaults to "isolated"
          },
          ctxQueue
        );

        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        // BACKLOG task is a fresh start, not resume (even when queued)
        expect(content.resumed).toBe(false);
        expect(content.task.status).toBe("IN_PROGRESS");
      } finally {
        queueDb.close();
        try {
          fs.unlinkSync(queueDbPath);
        } catch {
          // Ignore cleanup errors
        }
        testDbQueue.cleanup();
      }
    });

    it("should resume non-queued IN_PROGRESS task by any session", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "In Progress Task",
        status: "IN_PROGRESS",
      });

      // Update task with session info (as if started by another session)
      client.tasks.update(task.id, { sessionId: "original-session" });

      // Resume with different session
      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "new-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(true);
    });

    it("should resume non-queued PR_REVIEW task by any session", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      // Create task directly in PR_REVIEW status (bypassing state machine)
      const task = createTestTask(client.tasks, plan.id, {
        title: "PR Review Task",
        status: "PR_REVIEW",
      });

      // Resume with new session
      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "new-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(true);
      expect(content.task.status).toBe("PR_REVIEW");
    });

    it("should return gracefully for COMPLETED task with context", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      // Create task directly in COMPLETED status (bypassing state machine)
      const task = createTestTask(client.tasks, plan.id, {
        title: "Completed Task",
        status: "COMPLETED",
      });

      // Try to load
      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "new-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      // Graceful return instead of error - includes task and issue context
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("COMPLETED");
      expect(content.message).toContain("COMPLETED");
      expect(content.message).toContain("No work needed");
      expect(content.issueNumber).toBe(issue.number);
    });

    it("should return gracefully for ABANDONED task with context", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      // Create task directly in ABANDONED status (bypassing state machine)
      const task = createTestTask(client.tasks, plan.id, {
        title: "Abandoned Task",
        status: "ABANDONED",
      });

      // Try to load
      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "new-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      // Graceful return instead of error - includes task and issue context
      expect(content.success).toBe(true);
      expect(content.task.status).toBe("ABANDONED");
      expect(content.message).toContain("ABANDONED");
      expect(content.message).toContain("No work needed");
      expect(content.issueNumber).toBe(issue.number);
    });

    it("should start fresh for non-queued BACKLOG task", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Backlog Task",
        status: "BACKLOG",
      });

      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "test-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(false); // Not resumed, fresh start
      expect(content.startedAt).toBeDefined();
      expect(content.task.status).toBe("IN_PROGRESS");
    });

    it("should start fresh for non-queued READY task", async () => {
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Ready Task",
        status: "READY",
      });

      const result = await handleLoadTaskSession(
        {
          taskId: task.id,
          sessionId: "test-session",
          mode: "main",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.resumed).toBe(false); // Not resumed, fresh start
      expect(content.startedAt).toBeDefined();
      expect(content.task.status).toBe("IN_PROGRESS");
    });
  });
});

/**
 * Schema Validation Tests for Task Tools
 */
describe("Task Tool Schema Validation", () => {
  describe("GetTaskSchema", () => {
    it("should accept taskId only", () => {
      const result = GetTaskSchema.safeParse({ taskId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should accept issueNumber and taskNumber", () => {
      const result = GetTaskSchema.safeParse({ issueNumber: 1, taskNumber: 2 });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = GetTaskSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("ListAvailableTasksSchema", () => {
    it("should accept issueNumber filter", () => {
      const result = ListAvailableTasksSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept planId filter", () => {
      const result = ListAvailableTasksSchema.safeParse({ planId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = ListAvailableTasksSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("UpdateTaskSchema", () => {
    it("should accept valid updates", () => {
      const input = {
        taskId: "uuid-here",
        title: "Updated Task",
        description: "Updated description",
        estimatedMinutes: 60,
      };
      const result = UpdateTaskSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept all valid update fields", () => {
      const input = {
        taskId: "uuid-here",
        title: "Updated Task",
        description: "Updated description",
        acceptanceCriteria: ["AC 1", "AC 2"],
        estimatedMinutes: 120,
        implementationPlan: "Use existing pattern",
        labels: { urgent: "", product: "Case Workflow" },
      };
      const result = UpdateTaskSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const input = { title: "Updated Task" };
      const result = UpdateTaskSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("LogTaskProgressSchema", () => {
    it("should accept valid progress log", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        message: "Completed first step",
      };
      const result = LogTaskProgressSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept filesModified", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        message: "Updated files",
        filesModified: ["src/file1.ts", "src/file2.ts"],
      };
      const result = LogTaskProgressSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const input = { taskId: "uuid-here" };
      const result = LogTaskProgressSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("GetTaskExecutionLogSchema", () => {
    it("should accept taskId", () => {
      const result = GetTaskExecutionLogSchema.safeParse({ taskId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const result = GetTaskExecutionLogSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("LoadTaskSessionSchema", () => {
    it("should accept required fields", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
      };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept valid execution mode", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        mode: "isolated",
      };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("isolated");
      }
    });

    it("should accept workerId for worker execution", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        workerId: "worker-uuid",
      };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject invalid mode", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        mode: "invalid-mode",
      };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing taskId", () => {
      const input = { sessionId: "session-here" };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing sessionId", () => {
      const input = { taskId: "uuid-here" };
      const result = LoadTaskSessionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("AbandonTaskSchema", () => {
    it("should accept required fields", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
      };
      const result = AbandonTaskSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept reason and force", () => {
      const input = {
        taskId: "uuid-here",
        sessionId: "session-here",
        reason: "Task is blocked",
        force: true,
      };
      const result = AbandonTaskSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const input = { taskId: "uuid-here" };
      const result = AbandonTaskSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DeleteTaskSchema", () => {
    it("should accept taskId", () => {
      const result = DeleteTaskSchema.safeParse({ taskId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const result = DeleteTaskSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("GetTaskExecutionPromptSchema", () => {
    it("should accept taskId", () => {
      const result = GetTaskExecutionPromptSchema.safeParse({ taskId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const result = GetTaskExecutionPromptSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("CheckTaskConflictsSchema", () => {
    it("should accept taskId", () => {
      const result = CheckTaskConflictsSchema.safeParse({ taskId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const result = CheckTaskConflictsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

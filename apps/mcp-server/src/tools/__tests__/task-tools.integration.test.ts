/**
 * Task Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createTestIssue,
  createTestPlan,
  createTestTask,
  runMcpHandler,
} from "../../test/helpers.js";
import {
  TaskSessionService,
  TaskManagementService,
  ConflictDetectionService,
  IssueService,
  TaskService,
  PlanDomainService,
  IssueDomainService,
  ProjectManagementService,
  type DbClient,
  type ProjectManagementClient,
} from "@dev-workflow/tracking";
import { MockGitWorktreeService } from "@dev-workflow/git/worktrees/mock-git-worktree-service.js";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import {
  handleGetTask,
  handleListAvailableTasks,
  handleUpdateTask,
  handleLogTaskProgress,
  handleGetTaskExecutionLog,
  handleLoadTaskSession,
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
} from "../../tools/task-tools.js";

/**
 * Tracking for mock service calls
 */
interface MockServiceCalls {
  autoAssign: Array<{ externalId: string }>;
}

/**
 * Create a minimal mock client for testing
 */
function createLocalMockClient(
  calls?: MockServiceCalls,
  config?: { enabled?: boolean; assignee?: string }
): ProjectManagementClient {
  const enabled = config?.enabled ?? true;
  const assignee = config?.assignee;

  return {
    providerId: "mock",
    displayName: "Mock Client",
    // Configuration methods
    isEnabled: () => enabled,
    getAssignee: () => assignee ?? null,
    getCustomLabels: () => [],
    getColumnForStatus: () => "Backlog",
    getProjectId: () => null,
    getLabelFieldMapping: () => ({}),
    // Auth/Validation
    checkAuth: () => Effect.succeed({ authenticated: true }),
    checkRepository: () => Effect.succeed({ accessible: true }),
    // Issue operations
    createIssue: () =>
      Effect.succeed({
        id: "1",
        numericId: 1,
        url: "https://example.com/1",
        nodeId: "mock_1",
        title: "Mock",
        body: "",
        state: "OPEN",
        labels: [],
      }),
    closeIssue: () => Effect.succeed(undefined as void),
    reopenIssue: () => Effect.succeed(undefined as void),
    getIssue: () => Effect.succeed(null),
    searchIssues: () => Effect.succeed([]),
    ensureLabelsExist: () => Effect.succeed(undefined as void),
    // Project operations
    addToProject: () => Effect.succeed({ success: true, itemId: "mock_item" }),
    moveToColumn: () => Effect.succeed(undefined as void),
    checkProject: () => Effect.succeed(true),
    getProjectDetails: () => Effect.succeed(null),
    getProjectStatusField: () => Effect.succeed(null),
    getProjectFields: () => Effect.succeed([]),
    setProjectItemField: () => Effect.succeed({ success: true }),
    clearProjectItemField: () => Effect.succeed({ success: true }),
    getAvailableLabels: () => Effect.succeed({ supported: true, labels: [] }),
    linkParentChild: () => Effect.succeed(undefined as void),
    addComment: () => Effect.succeed(undefined as void),
    assignIssue: (externalId: string) => {
      // Only track calls if there's an assignee (like real client behavior)
      if (calls && assignee) {
        calls.autoAssign.push({ externalId });
      }
      return Effect.succeed(undefined as void);
    },
  };
}

/**
 * Create a mock ProjectManagementService for testing
 */
function createLocalMockService(
  calls?: MockServiceCalls,
  config?: { enabled?: boolean; assignee?: string }
): ProjectManagementService {
  const mockClient = createLocalMockClient(calls, config);
  return new ProjectManagementService(mockClient);
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
    mockServiceCalls?: MockServiceCalls;
    githubSync?: {
      enabled: boolean;
      assignee?: string;
    };
  }
): Promise<{ ctx: TestTaskToolContext; client: DbClient }> {
  // Create project first with optional GitHub sync config
  const project = await Effect.runPromise(
    testDb.source.projects.create({
      name: "Test Project",
      gitRootHash: "test-hash-" + crypto.randomUUID().slice(0, 8),
      syncConfig: options?.githubSync ?? null,
    })
  );

  const projectId = project.id;
  const client = createClientForProject(testDb, projectId);

  // Mock services
  const mockGitWorktreeService = new MockGitWorktreeService();
  const projectManagement = createLocalMockService(options?.mockServiceCalls, options?.githubSync);

  const conflictDetectionService = new ConflictDetectionService(client);

  const taskSessionService = new TaskSessionService(
    client,
    mockGitWorktreeService,
    conflictDetectionService
  );

  const taskManagementService = new TaskManagementService(client);

  const planDomainService = new PlanDomainService(client.plans, client.tasks, client.issues);
  const issueDomainService = new IssueDomainService(client.issues);
  const taskService = new TaskService(client, projectManagement, mockGitWorktreeService);
  const issueService = new IssueService(client, taskService, projectManagement);

  return {
    ctx: {
      dbClient: client,
      issueService,
      planDomainService,
      issueDomainService,
      taskService,
      workerQueueDb,
      taskSessionService,
      taskManagementService,
      conflictDetectionService,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // handleGetTask returns task fields directly (not wrapped in task object)
      expect(content.title).toBe("Test Task");
      expect(content.status).toBe("BACKLOG");
    });

    it("should get task by issue and task number", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      await createTestTask(client.tasks, plan.id, { title: "First Task" });

      const result = await runMcpHandler(
        handleGetTask,
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
      const result = await runMcpHandler(handleGetTask, { taskId: "non-existent-id" }, ctx);

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return stored task number", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task1 = await createTestTask(client.tasks, plan.id, { title: "Task 1" });
      const task2 = await createTestTask(client.tasks, plan.id, { title: "Task 2" });

      const result1 = await runMcpHandler(handleGetTask, { taskId: task1.id }, ctx);
      const result2 = await runMcpHandler(handleGetTask, { taskId: task2.id }, ctx);

      const content1 = JSON.parse(result1.content[0].text);
      const content2 = JSON.parse(result2.content[0].text);

      expect(content1.number).toBe(1);
      expect(content2.number).toBe(2);
    });

    it("should find task by stored number", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      await createTestTask(client.tasks, plan.id, { title: "Task 1" });
      await createTestTask(client.tasks, plan.id, { title: "Task 2" });

      const result = await runMcpHandler(
        handleGetTask,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        type: "FEATURE",
        labels: { priority: "high", sprint: "sprint-1" },
      });

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.type).toBe("FEATURE");
      expect(content.labels).toEqual({ priority: "high", sprint: "sprint-1" });
    });

    it("should return workerInfo when task is IN_PROGRESS with session", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task in progress",
        status: "IN_PROGRESS",
      });

      // Simulate a task with sessionId (as would happen during load_task_session)
      await Effect.runPromise(client.tasks.update(task.id, { sessionId: "test-session-123" }));

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("IN_PROGRESS");
      expect(content.workerInfo).toBeDefined();
      expect(content.workerInfo.sessionId).toBe("test-session-123");
      // workerId will be null since no dispatch queue entry
      expect(content.workerInfo.workerId).toBeNull();
    });

    it("should not return workerInfo when task is not IN_PROGRESS", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task in backlog",
        status: "BACKLOG",
      });

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.status).toBe("BACKLOG");
      expect(content.workerInfo).toBeUndefined();
    });

    it("should return prInfo when task has a PR", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with PR",
        status: "PR_REVIEW",
      });

      // Simulate a task with PR info
      await Effect.runPromise(
        client.tasks.update(task.id, {
          prNumber: 42,
          prUrl: "https://github.com/test/repo/pull/42",
          prStatus: "OPEN",
        })
      );

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeDefined();
      expect(content.prInfo.prNumber).toBe(42);
      expect(content.prInfo.prUrl).toBe("https://github.com/test/repo/pull/42");
      expect(content.prInfo.prStatus).toBe("OPEN");
    });

    it("should not return prInfo when task has no PR", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task without PR",
        status: "IN_PROGRESS",
      });

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.prInfo).toBeUndefined();
    });

    it("should return both workerInfo and prInfo when applicable", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with worker and PR",
        status: "IN_PROGRESS",
      });

      // Simulate a task with both session and PR info
      await Effect.runPromise(
        client.tasks.update(task.id, {
          sessionId: "session-456",
          prNumber: 99,
          prUrl: "https://github.com/test/repo/pull/99",
          prStatus: "DRAFT",
        })
      );

      const result = await runMcpHandler(handleGetTask, { taskId: task.id }, ctx);

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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      await createTestTask(client.tasks, plan.id, { title: "Task 1", status: "BACKLOG" });
      await createTestTask(client.tasks, plan.id, { title: "Task 2", status: "READY" });
      await createTestTask(client.tasks, plan.id, { title: "Task 3", status: "IN_PROGRESS" });

      const result = await runMcpHandler(handleListAvailableTasks, {}, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      // Only BACKLOG and READY tasks are available
      expect(content.tasks.length).toBe(2);
    });

    it("should filter by issue number", async () => {
      const issue1 = await createTestIssue(client.issues, { title: "Issue 1" });
      const issue2 = await createTestIssue(client.issues, { title: "Issue 2" });
      const plan1 = await createTestPlan(client.plans, issue1.id);
      const plan2 = await createTestPlan(client.plans, issue2.id);
      await createTestTask(client.tasks, plan1.id, { title: "Task A", status: "BACKLOG" });
      await createTestTask(client.tasks, plan2.id, { title: "Task B", status: "BACKLOG" });

      const result = await runMcpHandler(
        handleListAvailableTasks,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      await createTestTask(client.tasks, plan.id, { title: "Task 1", status: "BACKLOG" });
      await createTestTask(client.tasks, plan.id, { title: "Task 2", status: "BACKLOG" });

      const result = await runMcpHandler(
        handleListAvailableTasks,
        { issueNumber: issue.number },
        ctx
      );

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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Original Title",
      });

      const result = await runMcpHandler(
        handleUpdateTask,
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
      const updated = await Effect.runPromise(client.tasks.findById(task.id));
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.description).toBe("New description");
      expect(updated!.estimatedMinutes).toBe(60);
    });

    it("should add labels to a task", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task without labels",
      });

      const result = await runMcpHandler(
        handleUpdateTask,
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
      const updated = await Effect.runPromise(client.tasks.findById(task.id));
      expect(updated!.labels).toEqual({
        priority: "high",
        sprint: "sprint-1",
        urgent: "",
      });
    });

    it("should merge labels with existing ones", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { existing: "value", toUpdate: "old" },
      });

      const result = await runMcpHandler(
        handleUpdateTask,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { keep: "value", remove: "gone" },
      });

      const result = await runMcpHandler(
        handleUpdateTask,
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
      const updated = await Effect.runPromise(client.tasks.findById(task.id));
      expect(updated!.labels).toEqual({ keep: "value" });
    });

    it("should clear all labels when all are removed", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Task with labels",
        labels: { only: "label" },
      });

      const result = await runMcpHandler(
        handleUpdateTask,
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
      const updated = await Effect.runPromise(client.tasks.findById(task.id));
      expect(updated!.labels).toBeUndefined();
    });
  });

  describe("handleLogTaskProgress and handleGetTaskExecutionLog", () => {
    it("should log and retrieve task progress", async () => {
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id);

      // Log progress
      const logResult = await runMcpHandler(
        handleLogTaskProgress,
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
      const getResult = await runMcpHandler(handleGetTaskExecutionLog, { taskId: task.id }, ctx);

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
      const mockCalls: MockServiceCalls = { autoAssign: [] };
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
            mockServiceCalls: mockCalls,
            githubSync: {
              enabled: true,
              assignee: "testuser",
            },
          }
        );

        // Create task with GitHub sync info
        const issue = await createTestIssue(clientWithAssignee.issues);
        const plan = await createTestPlan(clientWithAssignee.plans, issue.id);
        const task = await createTestTask(clientWithAssignee.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        await Effect.runPromise(
          clientWithAssignee.tasks.updateSyncState(task.id, {
            externalId: "42",
            externalUrl: "https://github.com/test/repo/issues/42",
            externalNodeId: "I_test_42",
            syncStatus: "SYNCED",
            lastSyncedAt: new Date().toISOString(),
            lastSyncError: null,
            remoteProjectId: null,
          })
        );

        // Start the task
        const result = await runMcpHandler(
          handleLoadTaskSession,
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main", // Use main mode to skip worktree creation
          },
          ctxWithAssignee
        );

        expect(result.isError).toBeUndefined();

        // Verify autoAssign was called with correct parameters
        expect(mockCalls.autoAssign.length).toBe(1);
        expect(mockCalls.autoAssign[0]).toEqual({
          externalId: "42",
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
      const mockCalls: MockServiceCalls = { autoAssign: [] };
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
            mockServiceCalls: mockCalls,
            githubSync: {
              enabled: true,
              // No assignee configured
            },
          }
        );

        // Create task with GitHub sync info
        const issue = await createTestIssue(clientNoAssignee.issues);
        const plan = await createTestPlan(clientNoAssignee.plans, issue.id);
        const task = await createTestTask(clientNoAssignee.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        await Effect.runPromise(
          clientNoAssignee.tasks.updateSyncState(task.id, {
            externalId: "42",
            externalUrl: "https://github.com/test/repo/issues/42",
            externalNodeId: "I_test_42",
            syncStatus: "SYNCED",
            lastSyncedAt: new Date().toISOString(),
            lastSyncError: null,
            remoteProjectId: null,
          })
        );

        // Start the task
        const result = await runMcpHandler(
          handleLoadTaskSession,
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxNoAssignee
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called
        expect(mockCalls.autoAssign.length).toBe(0);
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
      const mockCalls: MockServiceCalls = { autoAssign: [] };
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
            mockServiceCalls: mockCalls,
          }
        );

        // Create task with GitHub sync info (simulating a previously synced task)
        const issue = await createTestIssue(clientDisabled.issues);
        const plan = await createTestPlan(clientDisabled.plans, issue.id);
        const task = await createTestTask(clientDisabled.tasks, plan.id, {
          title: "Task with GitHub",
          status: "BACKLOG",
        });

        // Add GitHub sync state to the task
        await Effect.runPromise(
          clientDisabled.tasks.updateSyncState(task.id, {
            externalId: "42",
            externalUrl: "https://github.com/test/repo/issues/42",
            externalNodeId: "I_test_42",
            syncStatus: "SYNCED",
            lastSyncedAt: new Date().toISOString(),
            lastSyncError: null,
            remoteProjectId: null,
          })
        );

        // Start the task
        const result = await runMcpHandler(
          handleLoadTaskSession,
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxDisabled
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called (sync is disabled)
        expect(mockCalls.autoAssign.length).toBe(0);
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
      const mockCalls: MockServiceCalls = { autoAssign: [] };
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
            mockServiceCalls: mockCalls,
            githubSync: {
              enabled: true,
              assignee: "testuser",
            },
          }
        );

        // Create task WITHOUT GitHub sync info
        const issue = await createTestIssue(clientNoSync.issues);
        const plan = await createTestPlan(clientNoSync.plans, issue.id);
        const task = await createTestTask(clientNoSync.tasks, plan.id, {
          title: "Task without GitHub",
          status: "BACKLOG",
        });

        // Don't add GitHub sync state - task has no linked GitHub issue

        // Start the task
        const result = await runMcpHandler(
          handleLoadTaskSession,
          {
            taskId: task.id,
            sessionId: "test-session",
            mode: "main",
          },
          ctxNoSync
        );

        expect(result.isError).toBeUndefined();

        // Verify assignIssue was NOT called (no GitHub issue linked)
        expect(mockCalls.autoAssign.length).toBe(0);
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
        const issue = await createTestIssue(clientQueue.issues);
        const plan = await createTestPlan(clientQueue.plans, issue.id);
        const task = await createTestTask(clientQueue.tasks, plan.id, {
          title: "Queued Task",
          status: "BACKLOG",
        });

        // Add task to dispatch queue (uses workerQueueDb)
        queueDb.enqueue(task.id, "test-project");

        // Try to start without workerId
        const result = await runMcpHandler(
          handleLoadTaskSession,
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
        const issue = await createTestIssue(clientQueue.issues);
        const plan = await createTestPlan(clientQueue.plans, issue.id);
        const task = await createTestTask(clientQueue.tasks, plan.id, {
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
        const result = await runMcpHandler(
          handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "In Progress Task",
        status: "IN_PROGRESS",
      });

      // Update task with session info (as if started by another session)
      await Effect.runPromise(client.tasks.update(task.id, { sessionId: "original-session" }));

      // Resume with different session
      const result = await runMcpHandler(
        handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      // Create task directly in PR_REVIEW status (bypassing state machine)
      const task = await createTestTask(client.tasks, plan.id, {
        title: "PR Review Task",
        status: "PR_REVIEW",
      });

      // Resume with new session
      const result = await runMcpHandler(
        handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      // Create task directly in COMPLETED status (bypassing state machine)
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Completed Task",
        status: "COMPLETED",
      });

      // Try to load
      const result = await runMcpHandler(
        handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      // Create task directly in ABANDONED status (bypassing state machine)
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Abandoned Task",
        status: "ABANDONED",
      });

      // Try to load
      const result = await runMcpHandler(
        handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Backlog Task",
        status: "BACKLOG",
      });

      const result = await runMcpHandler(
        handleLoadTaskSession,
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
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Ready Task",
        status: "READY",
      });

      const result = await runMcpHandler(
        handleLoadTaskSession,
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

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
  MockGitHubCLI,
  MockGitWorktreeService,
  SqliteProjectRepository,
  TaskGitHubSyncService,
  taskExecutionLogs,
} from "@dev-workflow/core";
import {
  handleGetTask,
  handleListAvailableTasks,
  handleUpdateTask,
  handleAddManualTask,
  handleLogTaskProgress,
  handleGetTaskExecutionLog,
  type TaskToolContext,
} from "../../tools/task-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_PROJECT_ID = "test-project-task";

/**
 * Create a TaskToolContext for testing
 */
function createTaskToolContext(testDb: TestDatabase): TaskToolContext {
  const db = testDb.db as DbType;
  const repos = createRepositories(testDb.db, TEST_PROJECT_ID);

  // Create project repository (project is auto-created, sync disabled by default)
  const projectRepository = new SqliteProjectRepository(db);

  // Mock services
  const mockLabelService = {
    loadLabelsForTask: async () => [],
    listAvailableLabels: async () => [],
    getLabel: async () => null,
    createLabel: async () => ({ name: "", content: "" }),
    updateLabel: async () => ({ name: "", content: "" }),
    removeLabel: async () => {},
  };

  const mockGitWorktreeService = new MockGitWorktreeService();
  const mockGitHubCLI = new MockGitHubCLI();

  const conflictDetectionService = new ConflictDetectionService(db, repos.taskRepository);

  const taskSessionService = new TaskSessionService(
    repos.taskRepository,
    repos.planRepository,
    repos.issueRepository,
    mockGitWorktreeService,
    conflictDetectionService,
    TEST_PROJECT_ID
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
    mockGitHubCLI,
    projectRepository,
    TEST_PROJECT_ID
  );

  return {
    dbService: { getDb: () => db } as any,
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    taskSessionService,
    taskManagementService,
    labelService: mockLabelService as any,
    taskExecutionLogsSchema: taskExecutionLogs,
    conflictDetectionService,
    taskGitHubSyncService,
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

  describe("handleAddManualTask", () => {
    it("should add a manual task to a plan", () => {
      const issue = createTestIssue(ctx.issueRepository);
      const plan = createTestPlan(ctx.planRepository, issue.id);

      const result = handleAddManualTask(ctx, {
        issueNumber: issue.number,
        title: "Manual Task",
        description: "Added manually",
        estimatedMinutes: 30,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.task.title).toBe("Manual Task");
      expect(content.task.source).toBe("manual");

      // Verify database state
      const tasks = ctx.taskRepository.findByPlanId(plan.id);
      expect(tasks.some((t) => t.source === "manual")).toBe(true);
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
});

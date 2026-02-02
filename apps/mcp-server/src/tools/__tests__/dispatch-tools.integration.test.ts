/**
 * Dispatch Tools Integration Tests
 *
 * Tests MCP tool handlers for worker dispatch operations.
 * Uses createMcpTool with test containers to test the full pipeline.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createContainer, asValue, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import {
  TaskService,
  type DbClient,
  DispatchTaskOperationSchema as DispatchTaskSchema,
  EndWorkerSessionOperationSchema as EndWorkerSessionSchema,
} from "@dev-workflow/tracking";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createTestIssue,
  createTestPlan,
  createTestTask,
  createNoOpProjectManagementService,
} from "../../test/helpers.js";
import {
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
} from "../../tools/dispatch-tools.js";
import { createMcpTool } from "../../di/bootstrap.js";

/**
 * Test cradle interface - subset of McpCradle for dispatch tools
 */
interface DispatchTestCradle {
  workerQueueDb: GlobalDbWorkerQueueDb;
  taskService: TaskService;
  projectSlug: string;
}

describe("Dispatch Tools Integration", () => {
  let testDb: TestDatabase;
  let client: DbClient;
  let workerQueueDbPath: string;
  let workerQueueDb: GlobalDbWorkerQueueDb;
  let testContainer: AwilixContainer<DispatchTestCradle>;

  // Bound tools for testing
  let dispatchTask: ReturnType<typeof createMcpTool>;
  let getDispatchStatus: ReturnType<typeof createMcpTool>;
  let endWorkerSession: ReturnType<typeof createMcpTool>;

  beforeEach(() => {
    testDb = createTestDatabase();
    client = testDb.client;

    // Create a temporary worker queue database for testing with unique path
    workerQueueDbPath = path.join(
      os.tmpdir(),
      `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
    );
    workerQueueDb = new GlobalDbWorkerQueueDb(workerQueueDbPath);

    const taskService = new TaskService(client, createNoOpProjectManagementService(), null);

    // Create test container with dependencies + tool class
    testContainer = createContainer<DispatchTestCradle>({
      injectionMode: InjectionMode.CLASSIC,
    });

    testContainer.register({
      workerQueueDb: asValue(workerQueueDb),
      taskService: asValue(taskService),
      projectSlug: asValue("test-project"),
    });

    // Bind handlers to test container - tests the full pipeline
    dispatchTask = createMcpTool(handleDispatchTask, testContainer);
    getDispatchStatus = createMcpTool(handleGetDispatchStatus, testContainer);
    endWorkerSession = createMcpTool(handleEndWorkerSession, testContainer);
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

  describe("handleGetDispatchStatus", () => {
    it("should return empty workers and queue when none exist", async () => {
      const result = await getDispatchStatus({});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.workers).toEqual([]);
      expect(content.workerSummary).toEqual({
        total: 0,
        idle: 0,
        working: 0,
        draining: 0,
      });
      expect(content.queue).toEqual([]);
      expect(content.queueStats).toEqual({
        total: 0,
        unclaimed: 0,
        claimed: 0,
        stale: 0,
      });
    });

    it("should return registered workers with their status", async () => {
      // Register workers using workerQueueDb
      workerQueueDb.registerWorker("worker-1", "worker-1");
      workerQueueDb.registerWorker("worker-2", "worker-2");
      workerQueueDb.updateStatus("worker-2", "WORKING");

      const result = await getDispatchStatus({});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.workers).toHaveLength(2);

      const worker1 = content.workers.find((w: { id: string }) => w.id === "worker-1");
      expect(worker1).toBeDefined();
      expect(worker1.name).toBe("worker-1");
      expect(worker1.status).toBe("IDLE");
      expect(worker1.isAlive).toBe(true);
      expect(worker1.currentTaskId).toBeNull();

      const worker2 = content.workers.find((w: { id: string }) => w.id === "worker-2");
      expect(worker2).toBeDefined();
      expect(worker2.status).toBe("WORKING");

      expect(content.workerSummary.total).toBe(2);
      expect(content.workerSummary.idle).toBe(1);
      expect(content.workerSummary.working).toBe(1);
    });

    it("should include dispatch queue entries", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Enqueue task using workerQueueDb
      workerQueueDb.enqueue(task.id, "test-project");

      const result = await getDispatchStatus({});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.queue).toHaveLength(1);
      expect(content.queue[0].taskId).toBe(task.id);
      expect(content.queue[0].status).toBe("PENDING");
      expect(content.queue[0].workerId).toBeNull();

      expect(content.queueStats.total).toBe(1);
      expect(content.queueStats.unclaimed).toBe(1);
    });

    it("should show current task for workers that have claimed tasks", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker using workerQueueDb
      workerQueueDb.registerWorker("worker-1", "worker-1");

      // Enqueue and claim task using workerQueueDb
      workerQueueDb.enqueue(task.id, "test-project");
      workerQueueDb.claimTask("worker-1");

      const result = await getDispatchStatus({});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Worker should have currentTaskId
      const worker = content.workers.find((w: { id: string }) => w.id === "worker-1");
      expect(worker).toBeDefined();
      expect(worker.currentTaskId).toBe(task.id);

      // Queue should show claimed status
      expect(content.queue[0].status).toBe("WORKING");
      expect(content.queue[0].workerId).toBe("worker-1");
      expect(content.queue[0].workerName).toBe("worker-1");
    });
  });

  describe("handleDispatchTask", () => {
    it("should dispatch a task and return queue entry", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      const result = await dispatchTask({ taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.alreadyQueued).toBe(false);

      // Should return queue entry details
      expect(content.queueEntry).toBeDefined();
      expect(content.queueEntry.taskId).toBe(task.id);
      expect(content.queueEntry.status).toBe("PENDING");
      expect(content.queueEntry.workerId).toBeNull();

      // No worker claimed yet
      expect(content.claimedByWorker).toBeNull();
    });

    it("should return alreadyQueued=true for duplicate dispatch", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Dispatch task twice
      await dispatchTask({ taskId: task.id });
      const result = await dispatchTask({ taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.alreadyQueued).toBe(true);
      expect(content.queueEntry).toBeDefined();
    });

    it("should return claimedByWorker when task is claimed", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and dispatch task using workerQueueDb
      workerQueueDb.registerWorker("worker-1", "worker-1");
      workerQueueDb.enqueue(task.id, "test-project");
      workerQueueDb.claimTask("worker-1");

      // Dispatch again (already queued and claimed)
      const result = await dispatchTask({ taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.alreadyQueued).toBe(true);
      expect(content.queueEntry.status).toBe("WORKING");
      expect(content.queueEntry.workerId).toBe("worker-1");

      // Should include claiming worker details
      expect(content.claimedByWorker).toBeDefined();
      expect(content.claimedByWorker.id).toBe("worker-1");
      expect(content.claimedByWorker.name).toBe("worker-1");
      expect(content.claimedByWorker.status).toBeDefined();
    });

    it("should reject dispatch for non-BACKLOG/READY tasks", async () => {
      // Create issue, plan, and task with IN_PROGRESS status
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });
      // Start the task so it's IN_PROGRESS
      await Effect.runPromise(
        client.tasks.updateStatus(task.id, "IN_PROGRESS", "test-session", "Started")
      );

      const result = await dispatchTask({ taskId: task.id });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("IN_PROGRESS");
    });

    it("should reject dispatch for non-existent task", async () => {
      const result = await dispatchTask({ taskId: "non-existent-uuid" });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });
  });

  describe("handleEndWorkerSession", () => {
    it("should set claudeDone flag for a worker's task", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and claim task using workerQueueDb
      workerQueueDb.registerWorker("worker-1", "worker-1");
      workerQueueDb.enqueue(task.id, "test-project");
      workerQueueDb.claimTask("worker-1");

      const result = await endWorkerSession({
        workerId: "worker-1",
        taskId: task.id,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.terminated).toBe(true);
      expect(content.alreadyDone).toBe(false);

      // Verify claudeDone is set using workerQueueDb
      const entry = workerQueueDb.findByTaskId(task.id);
      expect(entry?.claudeDone).toBe(true);
    });

    it("should reject end_worker_session with wrong workerId", async () => {
      // Create issue, plan, and task
      const issue = await createTestIssue(client.issues);
      const plan = await createTestPlan(client.plans, issue.id);
      const task = await createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and claim task using workerQueueDb
      workerQueueDb.registerWorker("worker-1", "worker-1");
      workerQueueDb.enqueue(task.id, "test-project");
      workerQueueDb.claimTask("worker-1");

      // Try to end with wrong worker ID
      const result = await endWorkerSession({
        workerId: "wrong-worker-id",
        taskId: task.id,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("does not own");
    });
  });
});

/**
 * Schema Validation Tests for Dispatch Tools
 */
describe("Dispatch Tool Schema Validation", () => {
  describe("DispatchTaskSchema", () => {
    it("should accept valid task dispatch", () => {
      const input = { taskId: "uuid-here", projectSlug: "test-project" };
      const result = DispatchTaskSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing taskId", () => {
      const result = DispatchTaskSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("GetDispatchStatus", () => {
    it("accepts no arguments (no schema needed)", () => {
      // getDispatchStatus takes no input - no schema to validate
      expect(true).toBe(true);
    });
  });

  describe("EndWorkerSessionSchema", () => {
    it("should accept valid input", () => {
      const input = { workerId: "worker-uuid", taskId: "task-uuid" };
      const result = EndWorkerSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing workerId", () => {
      const input = { taskId: "task-uuid" };
      const result = EndWorkerSessionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing taskId", () => {
      const input = { workerId: "worker-uuid" };
      const result = EndWorkerSessionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

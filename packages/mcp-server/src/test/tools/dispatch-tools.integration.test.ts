/**
 * Dispatch Tools Integration Tests
 *
 * Tests MCP tool handlers for worker dispatch operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DispatchService,
  WorkerService,
  TaskService,
  type DbClient,
  type DbSource,
} from "@dev-workflow/core";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createTestIssue, createTestPlan, createTestTask, createNoOpProvider } from "../helpers.js";
import {
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
  type DispatchToolContext,
} from "../../tools/dispatch-tools.js";

describe("Dispatch Tools Integration", () => {
  let testDb: TestDatabase;
  let client: DbClient;
  let source: DbSource;
  let ctx: DispatchToolContext;

  beforeEach(() => {
    testDb = createTestDatabase();
    client = testDb.client;
    source = testDb.source;

    // Create services - worker/dispatch use DbSource (global), taskService uses DbClient (project-scoped)
    const dispatchService = new DispatchService(source);
    const workerService = new WorkerService(source);
    const taskService = new TaskService(client, createNoOpProvider(), null);

    ctx = {
      dispatchService,
      taskService,
      workerService,
    };
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("handleGetDispatchStatus", () => {
    it("should return empty workers and queue when none exist", () => {
      const result = handleGetDispatchStatus(ctx);

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

    it("should return registered workers with their status", () => {
      // Register workers
      client.workers.register("worker-1", "worker-1");
      client.workers.register("worker-2", "worker-2");
      client.workers.updateStatus("worker-2", "WORKING");

      const result = handleGetDispatchStatus(ctx);

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

    it("should include dispatch queue entries", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Enqueue task
      client.dispatchQueue.enqueue(task.id);

      const result = handleGetDispatchStatus(ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.queue).toHaveLength(1);
      expect(content.queue[0].taskId).toBe(task.id);
      expect(content.queue[0].status).toBe("PENDING");
      expect(content.queue[0].workerId).toBeNull();

      expect(content.queueStats.total).toBe(1);
      expect(content.queueStats.unclaimed).toBe(1);
    });

    it("should show current task for workers that have claimed tasks", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker
      client.workers.register("worker-1", "worker-1");

      // Enqueue and claim task
      client.dispatchQueue.enqueue(task.id);
      client.dispatchQueue.claimTask("worker-1");

      const result = handleGetDispatchStatus(ctx);

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
    it("should dispatch a task and return queue entry", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      const result = handleDispatchTask(ctx, { taskId: task.id });

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

    it("should return alreadyQueued=true for duplicate dispatch", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Dispatch task twice
      handleDispatchTask(ctx, { taskId: task.id });
      const result = handleDispatchTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.alreadyQueued).toBe(true);
      expect(content.queueEntry).toBeDefined();
    });

    it("should return claimedByWorker when task is claimed", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and dispatch task
      client.workers.register("worker-1", "worker-1");
      client.dispatchQueue.enqueue(task.id);
      client.dispatchQueue.claimTask("worker-1");

      // Dispatch again (already queued and claimed)
      const result = handleDispatchTask(ctx, { taskId: task.id });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.alreadyQueued).toBe(true);
      expect(content.queueEntry.status).toBe("WORKING");
      expect(content.queueEntry.workerId).toBe("worker-1");

      // Should include claiming worker details
      expect(content.claimedByWorker).toBeDefined();
      expect(content.claimedByWorker.id).toBe("worker-1");
      expect(content.claimedByWorker.name).toBe("worker-1");
      expect(content.claimedByWorker.isAlive).toBe(true);
    });

    it("should reject dispatch for non-BACKLOG/READY tasks", () => {
      // Create issue, plan, and task with IN_PROGRESS status
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });
      // Start the task so it's IN_PROGRESS
      client.tasks.updateStatus(task.id, "IN_PROGRESS", "test-session", "Started");

      const result = handleDispatchTask(ctx, { taskId: task.id });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("IN_PROGRESS");
    });

    it("should reject dispatch for non-existent task", () => {
      const result = handleDispatchTask(ctx, { taskId: "non-existent-uuid" });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });
  });

  describe("handleEndWorkerSession", () => {
    it("should set claudeDone flag for a worker's task", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and claim task
      client.workers.register("worker-1", "worker-1");
      client.dispatchQueue.enqueue(task.id);
      client.dispatchQueue.claimTask("worker-1");

      const result = handleEndWorkerSession(ctx, {
        workerId: "worker-1",
        taskId: task.id,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.terminated).toBe(true);
      expect(content.alreadyDone).toBe(false);

      // Verify claudeDone is set
      const entry = client.dispatchQueue.findByTaskId(task.id);
      expect(entry?.claudeDone).toBe(true);
    });

    it("should reject end_worker_session with wrong workerId", () => {
      // Create issue, plan, and task
      const issue = createTestIssue(client.issues);
      const plan = createTestPlan(client.plans, issue.id);
      const task = createTestTask(client.tasks, plan.id, {
        title: "Test Task",
        status: "BACKLOG",
      });

      // Register worker and claim task
      client.workers.register("worker-1", "worker-1");
      client.dispatchQueue.enqueue(task.id);
      client.dispatchQueue.claimTask("worker-1");

      // Try to end with wrong worker ID
      const result = handleEndWorkerSession(ctx, {
        workerId: "wrong-worker-id",
        taskId: task.id,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("mismatch");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../../../__tests__/helpers.js";

describe("SqliteTaskRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let planId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);

    // Create issue and plan for tasks
    const issue = createTestIssue(repos.issueRepository);
    const plan = createTestPlan(repos.planRepository, issue.id);
    planId = plan.id;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("create", () => {
    it("should create a task with all fields", () => {
      const task = repos.taskRepository.create({
        planId,
        title: "Test Task",
        description: "Test description",
        status: "PENDING",
        source: "generated",
        acceptanceCriteria: ["AC 1", "AC 2"],
        estimatedMinutes: 30,
        isDeleted: false,
      });

      expect(task.id).toBeDefined();
      expect(task.planId).toBe(planId);
      expect(task.title).toBe("Test Task");
      expect(task.status).toBe("PENDING");
      expect(task.source).toBe("generated");
      expect(task.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
      expect(task.estimatedMinutes).toBe(30);
      expect(task.isDeleted).toBe(false);
      expect(task.order).toBe(1);
    });

    it("should create manual tasks with source=manual", () => {
      const task = repos.taskRepository.create({
        planId,
        title: "Manual Task",
        description: "User-created task",
        status: "PENDING",
        source: "manual",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      expect(task.source).toBe("manual");
    });

    it("should auto-increment order within a plan", () => {
      const task1 = createTestTask(repos.taskRepository, planId);
      const task2 = createTestTask(repos.taskRepository, planId);
      const task3 = createTestTask(repos.taskRepository, planId);

      expect(task1.order).toBe(1);
      expect(task2.order).toBe(2);
      expect(task3.order).toBe(3);
    });
  });

  describe("findByPlanId", () => {
    it("should return tasks for a plan", () => {
      createTestTask(repos.taskRepository, planId, { title: "Task 1" });
      createTestTask(repos.taskRepository, planId, { title: "Task 2" });

      const tasks = repos.taskRepository.findByPlanId(planId);
      expect(tasks).toHaveLength(2);
    });

    it("should exclude deleted tasks by default", () => {
      const task1 = createTestTask(repos.taskRepository, planId);
      const task2 = createTestTask(repos.taskRepository, planId);

      repos.taskRepository.softDelete(task1.id, "test");

      const tasks = repos.taskRepository.findByPlanId(planId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe(task2.id);
    });

    it("should include deleted tasks when requested", () => {
      const task1 = createTestTask(repos.taskRepository, planId);
      createTestTask(repos.taskRepository, planId);

      repos.taskRepository.softDelete(task1.id, "test");

      const tasks = repos.taskRepository.findByPlanId(planId, true);
      expect(tasks).toHaveLength(2);
    });
  });

  describe("updateStatus", () => {
    it("should update task status", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const updated = repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

      expect(updated.status).toBe("IN_PROGRESS");
    });

    it("should set startedAt when status changes to IN_PROGRESS", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const updated = repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

      expect(updated.startedAt).toBeDefined();
    });

    it("should set completedAt when status changes to COMPLETED", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const updated = repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");

      expect(updated.completedAt).toBeDefined();
    });

    it("should set abandonedAt when status changes to ABANDONED", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const updated = repos.taskRepository.updateStatus(task.id, "ABANDONED", "test");

      expect(updated.abandonedAt).toBeDefined();
    });
  });

  describe("softDelete", () => {
    it("should mark task as deleted", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const deleted = repos.taskRepository.softDelete(task.id, "test-user");

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeDefined();
      expect(deleted.deletedBy).toBe("test-user");
    });

    it("should only allow deleting PENDING tasks", () => {
      const task = createTestTask(repos.taskRepository, planId);
      repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

      expect(() => {
        repos.taskRepository.softDelete(task.id, "test");
      }).toThrow(/status/);
    });
  });

  describe("restore", () => {
    it("should restore a soft-deleted task", () => {
      const task = createTestTask(repos.taskRepository, planId);
      repos.taskRepository.softDelete(task.id, "test");

      const restored = repos.taskRepository.restore(task.id);

      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.deletedBy).toBeUndefined();
    });
  });

  describe("findMany", () => {
    beforeEach(() => {
      createTestTask(repos.taskRepository, planId, { status: "PENDING", source: "generated" });
      createTestTask(repos.taskRepository, planId, { status: "IN_PROGRESS", source: "generated" });
      createTestTask(repos.taskRepository, planId, { status: "PENDING", source: "manual" });
    });

    it("should filter by status", () => {
      const pending = repos.taskRepository.findMany({ status: "PENDING" });
      expect(pending).toHaveLength(2);
    });

    it("should filter by source", () => {
      const manual = repos.taskRepository.findMany({ source: "manual" });
      expect(manual).toHaveLength(1);
      expect(manual[0]?.source).toBe("manual");
    });

    it("should combine filters", () => {
      const filtered = repos.taskRepository.findMany({
        status: "PENDING",
        source: "generated",
      });
      expect(filtered).toHaveLength(1);
    });
  });
});

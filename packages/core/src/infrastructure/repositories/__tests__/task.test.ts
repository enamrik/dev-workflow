import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import {
  createRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../../__tests__/helpers.js";
import { InvalidStatusTransitionError } from "../../../domain/errors.js";

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
      const taskId = crypto.randomUUID();
      const task = repos.taskRepository.create({
        id: taskId,
        planId,
        title: "Test Task",
        description: "Test description",
        status: "BACKLOG",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: ["AC 1", "AC 2"],
        estimatedMinutes: 30,
        isDeleted: false,
      });

      expect(task.id).toBe(taskId);
      expect(task.planId).toBe(planId);
      expect(task.title).toBe("Test Task");
      expect(task.status).toBe("BACKLOG");
      expect(task.type).toBe("FEATURE");
      expect(task.source).toBe("generated");
      expect(task.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
      expect(task.estimatedMinutes).toBe(30);
      expect(task.isDeleted).toBe(false);
      expect(task.order).toBe(1);
    });

    it("should create manual tasks with source=manual", () => {
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId,
        title: "Manual Task",
        description: "User-created task",
        status: "BACKLOG",
        type: "TASK",
        source: "manual",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      expect(task.source).toBe("manual");
    });

    it("should create tasks with different types", () => {
      const bugTask = createTestTask(repos.taskRepository, planId, {
        title: "Bug Fix",
        type: "BUG",
      });
      const featureTask = createTestTask(repos.taskRepository, planId, {
        title: "New Feature",
        type: "FEATURE",
      });
      const enhancementTask = createTestTask(repos.taskRepository, planId, {
        title: "Enhancement",
        type: "ENHANCEMENT",
      });

      expect(bugTask.type).toBe("BUG");
      expect(featureTask.type).toBe("FEATURE");
      expect(enhancementTask.type).toBe("ENHANCEMENT");
    });

    it("should persist and retrieve task type", () => {
      const task = createTestTask(repos.taskRepository, planId, {
        type: "BUG",
      });

      const retrieved = repos.taskRepository.findById(task.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.type).toBe("BUG");
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
      // First move to IN_PROGRESS (valid from BACKLOG)
      repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

      // Then complete (valid from IN_PROGRESS)
      const updated = repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");

      expect(updated.completedAt).toBeDefined();
    });

    it("should set abandonedAt when status changes to ABANDONED", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const updated = repos.taskRepository.updateStatus(task.id, "ABANDONED", "test");

      expect(updated.abandonedAt).toBeDefined();
    });

    it("should set submittedForReviewAt when status changes to PR_REVIEW", () => {
      const task = createTestTask(repos.taskRepository, planId);
      // First move to IN_PROGRESS (valid from BACKLOG)
      repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

      // Then submit for review (valid from IN_PROGRESS)
      const updated = repos.taskRepository.updateStatus(task.id, "PR_REVIEW", "test");

      expect(updated.status).toBe("PR_REVIEW");
      expect(updated.submittedForReviewAt).toBeDefined();
    });

    it("should allow full lifecycle: BACKLOG -> IN_PROGRESS -> PR_REVIEW -> COMPLETED", () => {
      const task = createTestTask(repos.taskRepository, planId);
      expect(task.status).toBe("BACKLOG");

      const inProgress = repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
      expect(inProgress.status).toBe("IN_PROGRESS");
      expect(inProgress.startedAt).toBeDefined();

      const prReview = repos.taskRepository.updateStatus(task.id, "PR_REVIEW", "test");
      expect(prReview.status).toBe("PR_REVIEW");
      expect(prReview.submittedForReviewAt).toBeDefined();

      const completed = repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");
      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).toBeDefined();
    });

    it("should return same task when transitioning to same status (no-op)", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const result = repos.taskRepository.updateStatus(task.id, "BACKLOG", "test");

      expect(result.status).toBe("BACKLOG");
      expect(result.id).toBe(task.id);
    });

    describe("status transition validation", () => {
      it("should reject BACKLOG -> COMPLETED (must go through IN_PROGRESS)", () => {
        const task = createTestTask(repos.taskRepository, planId);

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject BACKLOG -> PR_REVIEW (must go through IN_PROGRESS)", () => {
        const task = createTestTask(repos.taskRepository, planId);

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "PR_REVIEW", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject IN_PROGRESS -> BACKLOG", () => {
        const task = createTestTask(repos.taskRepository, planId);
        repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "BACKLOG", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject IN_PROGRESS -> READY", () => {
        const task = createTestTask(repos.taskRepository, planId);
        repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "READY", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject PR_REVIEW -> IN_PROGRESS", () => {
        const task = createTestTask(repos.taskRepository, planId);
        repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
        repos.taskRepository.updateStatus(task.id, "PR_REVIEW", "test");

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject COMPLETED -> any status (terminal state)", () => {
        const task = createTestTask(repos.taskRepository, planId);
        repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
        repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should reject ABANDONED -> any status (terminal state)", () => {
        const task = createTestTask(repos.taskRepository, planId);
        repos.taskRepository.updateStatus(task.id, "ABANDONED", "test");

        expect(() => {
          repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test");
        }).toThrow(InvalidStatusTransitionError);
      });

      it("should allow READY -> BACKLOG (for pause_issue)", () => {
        const task = createTestTask(repos.taskRepository, planId);
        // First move to READY
        repos.taskRepository.updateStatus(task.id, "READY", "test");

        // Then back to BACKLOG (valid for pause_issue)
        const updated = repos.taskRepository.updateStatus(task.id, "BACKLOG", "test");

        expect(updated.status).toBe("BACKLOG");
      });

      it("should only allow READY -> BACKLOG (not BACKLOG -> BACKLOG)", () => {
        const task = createTestTask(repos.taskRepository, planId);

        // BACKLOG -> BACKLOG is a no-op, should return same task
        const result = repos.taskRepository.updateStatus(task.id, "BACKLOG", "test");

        expect(result.status).toBe("BACKLOG");
      });

      it("should include allowed transitions in error message", () => {
        const task = createTestTask(repos.taskRepository, planId);

        try {
          repos.taskRepository.updateStatus(task.id, "COMPLETED", "test");
          expect.fail("Should have thrown InvalidStatusTransitionError");
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidStatusTransitionError);
          const e = error as InvalidStatusTransitionError;
          expect(e.fromStatus).toBe("BACKLOG");
          expect(e.toStatus).toBe("COMPLETED");
          expect(e.message).toContain("READY");
          expect(e.message).toContain("IN_PROGRESS");
          expect(e.message).toContain("ABANDONED");
        }
      });
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

    it("should only allow deleting BACKLOG tasks", () => {
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
      createTestTask(repos.taskRepository, planId, { status: "BACKLOG", source: "generated" });
      createTestTask(repos.taskRepository, planId, { status: "IN_PROGRESS", source: "generated" });
      createTestTask(repos.taskRepository, planId, { status: "BACKLOG", source: "manual" });
    });

    it("should filter by status", () => {
      const pending = repos.taskRepository.findMany({ status: "BACKLOG" });
      expect(pending).toHaveLength(2);
    });

    it("should filter by source", () => {
      const manual = repos.taskRepository.findMany({ source: "manual" });
      expect(manual).toHaveLength(1);
      expect(manual[0]?.source).toBe("manual");
    });

    it("should combine filters", () => {
      const filtered = repos.taskRepository.findMany({
        status: "BACKLOG",
        source: "generated",
      });
      expect(filtered).toHaveLength(1);
    });
  });

  describe("getStatusHistory", () => {
    it("should return empty array for task with no status changes", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const history = repos.taskRepository.getStatusHistory(task.id);

      expect(history).toEqual([]);
    });

    it("should return status changes in reverse chronological order", () => {
      const task = createTestTask(repos.taskRepository, planId);

      // Trigger status changes
      repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "user1");
      repos.taskRepository.updateStatus(task.id, "PR_REVIEW", "user2");
      repos.taskRepository.updateStatus(task.id, "COMPLETED", "user3");

      const history = repos.taskRepository.getStatusHistory(task.id);

      expect(history).toHaveLength(3);
      // Newest first
      expect(history[0]?.fromStatus).toBe("PR_REVIEW");
      expect(history[0]?.toStatus).toBe("COMPLETED");
      expect(history[1]?.fromStatus).toBe("IN_PROGRESS");
      expect(history[1]?.toStatus).toBe("PR_REVIEW");
      expect(history[2]?.fromStatus).toBe("BACKLOG");
      expect(history[2]?.toStatus).toBe("IN_PROGRESS");
    });

    it("should include changedBy information", () => {
      const task = createTestTask(repos.taskRepository, planId);

      repos.taskRepository.updateStatus(task.id, "IN_PROGRESS", "test-user");

      const history = repos.taskRepository.getStatusHistory(task.id);

      expect(history[0]?.changedBy).toBe("test-user");
    });

    it("should include notes when provided", () => {
      const task = createTestTask(repos.taskRepository, planId);

      repos.taskRepository.updateStatus(task.id, "ABANDONED", "user", "Not feasible");

      const history = repos.taskRepository.getStatusHistory(task.id);

      expect(history[0]?.notes).toBe("Not feasible");
    });
  });

  describe("getExecutionLogs", () => {
    it("should return empty array for task with no logs", () => {
      const task = createTestTask(repos.taskRepository, planId);

      const logs = repos.taskRepository.getExecutionLogs(task.id);

      expect(logs).toEqual([]);
    });
  });

  describe("getNextTaskNumber", () => {
    it("should return 1 for empty plan", () => {
      const nextNumber = repos.taskRepository.getNextTaskNumber(planId);

      expect(nextNumber).toBe(1);
    });

    it("should return max+1 for plan with tasks", () => {
      createTestTask(repos.taskRepository, planId, { title: "Task 1" });
      createTestTask(repos.taskRepository, planId, { title: "Task 2" });

      const nextNumber = repos.taskRepository.getNextTaskNumber(planId);

      expect(nextNumber).toBe(3);
    });

    it("should include soft-deleted tasks when calculating next number (numbers are immutable)", () => {
      // Create 3 tasks (numbers 1, 2, 3)
      const task1 = createTestTask(repos.taskRepository, planId, { title: "Task 1" });
      const task2 = createTestTask(repos.taskRepository, planId, { title: "Task 2" });
      const task3 = createTestTask(repos.taskRepository, planId, { title: "Task 3" });

      // Soft delete all tasks (simulates plan regeneration)
      repos.taskRepository.softDelete(task1.id);
      repos.taskRepository.softDelete(task2.id);
      repos.taskRepository.softDelete(task3.id);

      // Next number should be 4 (includes soft-deleted tasks since numbers are immutable)
      const nextNumber = repos.taskRepository.getNextTaskNumber(planId);

      expect(nextNumber).toBe(4);
    });

    it("should return max of all tasks + 1 including deleted ones (numbers are immutable)", () => {
      // Create 3 tasks (numbers 1, 2, 3)
      createTestTask(repos.taskRepository, planId, { title: "Task 1" });
      const task2 = createTestTask(repos.taskRepository, planId, { title: "Task 2" });
      createTestTask(repos.taskRepository, planId, { title: "Task 3" });

      // Soft delete task 2 only
      repos.taskRepository.softDelete(task2.id);

      // Next number should be 4 (max of ALL tasks including deleted is 3)
      const nextNumber = repos.taskRepository.getNextTaskNumber(planId);

      expect(nextNumber).toBe(4);
    });
  });

  describe("labels", () => {
    it("should create a task with labels", () => {
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId,
        title: "Labeled Task",
        description: "Has labels",
        status: "BACKLOG",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        labels: { bug: "", product: "Case Workflow" },
      });

      expect(task.labels).toEqual({ bug: "", product: "Case Workflow" });
    });

    it("should persist and retrieve labels", () => {
      const created = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId,
        title: "Labeled Task",
        description: "Has labels",
        status: "BACKLOG",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        labels: { urgent: "", "Product Area": "HR Portal" },
      });

      const found = repos.taskRepository.findById(created.id);
      expect(found?.labels).toEqual({ urgent: "", "Product Area": "HR Portal" });
    });

    it("should update labels via update method", () => {
      const created = createTestTask(repos.taskRepository, planId);
      expect(created.labels).toBeUndefined();

      const updated = repos.taskRepository.update(created.id, {
        labels: { feature: "", priority: "high" },
      });

      expect(updated.labels).toEqual({ feature: "", priority: "high" });
    });

    it("should allow labels to be undefined", () => {
      const task = createTestTask(repos.taskRepository, planId);

      expect(task.labels).toBeUndefined();
    });

    it("should handle empty labels object", () => {
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId,
        title: "Empty Labels Task",
        description: "Has empty labels object",
        status: "BACKLOG",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        labels: {},
      });

      expect(task.labels).toEqual({});
    });

    it("should handle labels with special characters", () => {
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId,
        title: "Special Labels Task",
        description: "Has special characters",
        status: "BACKLOG",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        labels: { "Product Area": "HR Portal / Admin", "env:prod": "" },
      });

      expect(task.labels).toEqual({
        "Product Area": "HR Portal / Admin",
        "env:prod": "",
      });
    });

    it("should create multiple tasks with labels via createMany", () => {
      const tasks = repos.taskRepository.createMany([
        {
          id: crypto.randomUUID(),
          planId,
          title: "Task 1",
          description: "First task",
          status: "PLANNED",
          type: "FEATURE",
          source: "generated",
          acceptanceCriteria: [],
          isDeleted: false,
          labels: { bug: "", product: "Case Workflow" },
        },
        {
          id: crypto.randomUUID(),
          planId,
          title: "Task 2",
          description: "Second task",
          status: "PLANNED",
          type: "ENHANCEMENT",
          source: "generated",
          acceptanceCriteria: [],
          isDeleted: false,
          labels: { urgent: "" },
        },
      ]);

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.labels).toEqual({ bug: "", product: "Case Workflow" });
      expect(tasks[1]?.labels).toEqual({ urgent: "" });
    });
  });
});

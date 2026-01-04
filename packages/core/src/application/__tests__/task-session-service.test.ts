/**
 * Task Session Service Tests
 *
 * Tests for task session management including BACKLOG → READY transitions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";
import { TaskSessionService } from "../task-session-service.js";

describe("TaskSessionService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let taskSessionService: TaskSessionService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);

    // Create service without git worktree support for unit tests
    taskSessionService = new TaskSessionService(
      repos.taskRepository,
      repos.planRepository,
      repos.issueRepository,
      undefined, // No git worktree service
      undefined, // No conflict detection service
      undefined // No track directory
    );
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("BACKLOG → READY transitions", () => {
    it("should transition all BACKLOG tasks to READY when starting any task", async () => {
      // Arrange: Create issue with plan and BACKLOG tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });
      const task2 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "BACKLOG",
      });
      const task3 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 3",
        status: "BACKLOG",
      });

      // Act: Start the first task
      const session = await taskSessionService.startTaskSession({
        taskId: task1.id,
        sessionId: "test-session-1",
        mode: "main", // Use main mode to avoid worktree creation
      });

      // Assert: Task 1 should be IN_PROGRESS, tasks 2 and 3 should be READY
      expect(session.task.status).toBe("IN_PROGRESS");

      const updatedTask2 = repos.taskRepository.findById(task2.id);
      const updatedTask3 = repos.taskRepository.findById(task3.id);

      expect(updatedTask2?.status).toBe("READY");
      expect(updatedTask3?.status).toBe("READY");
    });

    it("should not transition tasks that are not BACKLOG", async () => {
      // Arrange: Create issue with plan and mixed status tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });
      const task2 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "COMPLETED",
      });
      const task3 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 3",
        status: "BACKLOG",
      });

      // Act: Start the first task
      await taskSessionService.startTaskSession({
        taskId: task1.id,
        sessionId: "test-session-1",
        mode: "main",
      });

      // Assert: Task 2 should remain COMPLETED, task 3 should be READY
      const updatedTask2 = repos.taskRepository.findById(task2.id);
      const updatedTask3 = repos.taskRepository.findById(task3.id);

      expect(updatedTask2?.status).toBe("COMPLETED");
      expect(updatedTask3?.status).toBe("READY");
    });

    it("should allow starting READY tasks", async () => {
      // Arrange: Create issue with plan and READY task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "READY",
      });

      // Act: Start the READY task
      const session = await taskSessionService.startTaskSession({
        taskId: task1.id,
        sessionId: "test-session-1",
        mode: "main",
      });

      // Assert: Task should be IN_PROGRESS
      expect(session.task.status).toBe("IN_PROGRESS");
    });

    it("should allow starting BACKLOG tasks", async () => {
      // Arrange: Create issue with plan and BACKLOG task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });

      // Act: Start the BACKLOG task
      const session = await taskSessionService.startTaskSession({
        taskId: task1.id,
        sessionId: "test-session-1",
        mode: "main",
      });

      // Assert: Task should be IN_PROGRESS
      expect(session.task.status).toBe("IN_PROGRESS");
    });

    it("should reject starting IN_PROGRESS tasks", async () => {
      // Arrange: Create issue with plan and IN_PROGRESS task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "IN_PROGRESS",
      });

      // Act & Assert: Should throw error
      await expect(
        taskSessionService.startTaskSession({
          taskId: task1.id,
          sessionId: "test-session-1",
          mode: "main",
        })
      ).rejects.toThrow(/must be BACKLOG or READY/);
    });
  });

  describe("abandonTaskSession with force mode", () => {
    it("should reject abandoning task with wrong session id without force", async () => {
      // Arrange: Create issue with plan and start a task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });

      // Start with session 1
      await taskSessionService.startTaskSession({
        taskId: task.id,
        sessionId: "session-1",
        mode: "main",
      });

      // Act & Assert: Try to abandon with session 2 - should fail
      await expect(
        taskSessionService.abandonTaskSession(task.id, "session-2", "wrong session")
      ).rejects.toThrow(/Task is not associated with session session-2/);
    });

    it("should allow abandoning task with wrong session id when force=true", async () => {
      // Arrange: Create issue with plan and start a task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });

      // Start with session 1
      await taskSessionService.startTaskSession({
        taskId: task.id,
        sessionId: "session-1",
        mode: "main",
      });

      // Act: Abandon with session 2 using force=true
      const abandonedTask = await taskSessionService.abandonTaskSession(
        task.id,
        "session-2",
        "state drifted, forcing",
        true // force=true
      );

      // Assert: Task should be abandoned despite session mismatch
      expect(abandonedTask.status).toBe("ABANDONED");
    });

    it("should allow abandoning task without session when force=true", async () => {
      // Arrange: Create a task that's IN_PROGRESS but has no session (orphaned state)
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "IN_PROGRESS", // Simulate orphaned state
      });

      // Act: Abandon with any session using force=true
      const abandonedTask = await taskSessionService.abandonTaskSession(
        task.id,
        "any-session",
        "recovering from orphaned state",
        true // force=true
      );

      // Assert: Task should be abandoned
      expect(abandonedTask.status).toBe("ABANDONED");
    });
  });

  describe("isTaskAvailable", () => {
    it("should return true for BACKLOG tasks", async () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task = createTestTask(repos.taskRepository, plan.id, {
        status: "BACKLOG",
      });

      const isAvailable = await taskSessionService.isTaskAvailable(task.id);
      expect(isAvailable).toBe(true);
    });

    it("should return true for READY tasks", async () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task = createTestTask(repos.taskRepository, plan.id, {
        status: "READY",
      });

      const isAvailable = await taskSessionService.isTaskAvailable(task.id);
      expect(isAvailable).toBe(true);
    });

    it("should return false for COMPLETED tasks", async () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task = createTestTask(repos.taskRepository, plan.id, {
        status: "COMPLETED",
      });

      const isAvailable = await taskSessionService.isTaskAvailable(task.id);
      expect(isAvailable).toBe(false);
    });
  });
});

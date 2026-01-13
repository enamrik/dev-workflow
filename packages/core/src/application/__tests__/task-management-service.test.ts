/**
 * Task Management Service Tests
 *
 * Tests for task deletion and immutability after PLANNED status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
  createServices,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";

describe("TaskManagementService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof getRepositories>;
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = getRepositories(testDb.client);
    services = createServices(testDb.client);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("deleteTask", () => {
    it("should allow deletion of PLANNED tasks", () => {
      // Arrange: Create issue with plan and PLANNED task
      const issue = createTestIssue(repos.issueRepository, { status: "PLANNED" });
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task to delete",
        status: "PLANNED",
      });

      // Act: Delete the task
      const deleted = services.taskManagementService.deleteTask(task.id, "test-user");

      // Assert: Task should be soft-deleted
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedBy).toBe("test-user");
    });

    it("should reject deletion of BACKLOG tasks", () => {
      // Arrange: Create issue with plan and BACKLOG task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "BACKLOG task",
        status: "BACKLOG",
      });

      // Act & Assert: Deletion should fail
      expect(() => services.taskManagementService.deleteTask(task.id, "test-user")).toThrow(
        /Cannot delete task with status BACKLOG.*PLANNED status.*abandon_task/
      );
    });

    it("should reject deletion of READY tasks", () => {
      // Arrange: Create issue with plan and READY task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "READY task",
        status: "READY",
      });

      // Act & Assert: Deletion should fail
      expect(() => services.taskManagementService.deleteTask(task.id, "test-user")).toThrow(
        /Cannot delete task with status READY.*PLANNED status.*abandon_task/
      );
    });

    it("should reject deletion of IN_PROGRESS tasks", () => {
      // Arrange: Create issue with plan and IN_PROGRESS task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "IN_PROGRESS task",
        status: "IN_PROGRESS",
      });

      // Act & Assert: Deletion should fail
      expect(() => services.taskManagementService.deleteTask(task.id, "test-user")).toThrow(
        /Cannot delete task with status IN_PROGRESS.*PLANNED status.*abandon_task/
      );
    });

    it("should reject deletion of PR_REVIEW tasks", () => {
      // Arrange: Create issue with plan and PR_REVIEW task
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "PR_REVIEW task",
        status: "PR_REVIEW",
      });

      // Act & Assert: Deletion should fail
      expect(() => services.taskManagementService.deleteTask(task.id, "test-user")).toThrow(
        /Cannot delete task with status PR_REVIEW.*PLANNED status.*abandon_task/
      );
    });

    it("should throw error for non-existent task", () => {
      // Act & Assert
      expect(() =>
        services.taskManagementService.deleteTask("non-existent-id", "test-user")
      ).toThrow(/Task not found/);
    });

    it("should throw error for already deleted task", () => {
      // Arrange: Create and delete a PLANNED task
      const issue = createTestIssue(repos.issueRepository, { status: "PLANNED" });
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task to delete twice",
        status: "PLANNED",
      });

      // First deletion succeeds
      services.taskManagementService.deleteTask(task.id, "test-user");

      // Act & Assert: Second deletion should fail
      expect(() => services.taskManagementService.deleteTask(task.id, "test-user")).toThrow(
        /Task is already deleted/
      );
    });
  });
});

/**
 * Planning Service Tests
 *
 * Tests for planning service including pauseIssue functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";
import { PlanningService } from "../planning-service.js";
import { VersioningService } from "../versioning-service.js";

describe("PlanningService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);

    // Create versioning service
    const versioningService = new VersioningService(
      repos.issueRepository,
      repos.snapshotRepository,
      repos.planRepository,
      repos.taskRepository
    );

    planningService = new PlanningService(
      repos.issueRepository,
      repos.planRepository,
      repos.taskRepository,
      versioningService
    );
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("pauseIssue", () => {
    it("should move all READY tasks to BACKLOG", () => {
      // Arrange: Create issue with plan and READY tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "READY",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "READY",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 3",
        status: "READY",
      });

      // Act
      const result = planningService.pauseIssue(issue.number);

      // Assert
      expect(result.count).toBe(3);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks.every((t) => t.status === "BACKLOG")).toBe(true);
    });

    it("should not move IN_PROGRESS tasks", () => {
      // Arrange: Create issue with mixed status tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "IN_PROGRESS",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "READY",
      });

      // Act
      const result = planningService.pauseIssue(issue.number);

      // Assert: Only READY task should be moved
      expect(result.count).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.title).toBe("Task 2");

      // IN_PROGRESS task should remain unchanged
      const updatedTask1 = repos.taskRepository.findById(task1.id);
      expect(updatedTask1?.status).toBe("IN_PROGRESS");
    });

    it("should not move COMPLETED tasks", () => {
      // Arrange: Create issue with COMPLETED and READY tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      const task1 = createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "COMPLETED",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "READY",
      });

      // Act
      const result = planningService.pauseIssue(issue.number);

      // Assert: Only READY task should be moved
      expect(result.count).toBe(1);

      // COMPLETED task should remain unchanged
      const updatedTask1 = repos.taskRepository.findById(task1.id);
      expect(updatedTask1?.status).toBe("COMPLETED");
    });

    it("should not move BACKLOG tasks", () => {
      // Arrange: Create issue with BACKLOG and READY tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "READY",
      });

      // Act
      const result = planningService.pauseIssue(issue.number);

      // Assert: Only READY task should be moved
      expect(result.count).toBe(1);
      expect(result.tasks[0]?.title).toBe("Task 2");
    });

    it("should return empty result when no READY tasks exist", () => {
      // Arrange: Create issue with no READY tasks
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 1",
        status: "BACKLOG",
      });
      createTestTask(repos.taskRepository, plan.id, {
        title: "Task 2",
        status: "COMPLETED",
      });

      // Act
      const result = planningService.pauseIssue(issue.number);

      // Assert
      expect(result.count).toBe(0);
      expect(result.tasks).toHaveLength(0);
    });

    it("should throw error if issue not found", () => {
      // Act & Assert
      expect(() => planningService.pauseIssue(9999)).toThrow("Issue not found: #9999");
    });

    it("should throw error if no plan exists for issue", () => {
      // Arrange: Create issue without a plan
      const issue = createTestIssue(repos.issueRepository);

      // Act & Assert
      expect(() => planningService.pauseIssue(issue.number)).toThrow(
        `No plan exists for issue #${issue.number}`
      );
    });
  });
});

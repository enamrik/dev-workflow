/**
 * Planning Service Tests
 *
 * Tests for planning service including pauseIssue functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";
import { PlanningService } from "../planning-service.js";
import { VersioningService } from "../versioning-service.js";

describe("PlanningService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof getRepositories>;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = getRepositories(testDb.client);

    // Create versioning service
    const versioningService = new VersioningService(testDb.client);

    planningService = new PlanningService(testDb.client, versioningService);
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

  describe("generatePlan - label inheritance", () => {
    it("should inherit labels from parent issue to new tasks", () => {
      // Arrange: Create issue with labels
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: ["AC 1"],
        labels: { bug: "", product: "Case Workflow" },
      });

      // Act: Generate plan
      const result = planningService.generatePlan({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First task",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second task",
            acceptanceCriteria: ["AC 2"],
            type: "ENHANCEMENT",
          },
        ],
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Assert: All tasks should inherit labels
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0]?.labels).toEqual({ bug: "", product: "Case Workflow" });
      expect(result.tasks[1]?.labels).toEqual({ bug: "", product: "Case Workflow" });
    });

    it("should not inherit labels if issue has no labels", () => {
      // Arrange: Create issue without labels
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: ["AC 1"],
      });

      // Act: Generate plan
      const result = planningService.generatePlan({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First task",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
        ],
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Assert: Task should have no labels
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.labels).toBeUndefined();
    });

    it("should preserve existing task labels on regeneration", () => {
      // Arrange: Create issue with labels
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: ["AC 1"],
        labels: { product: "Initial" },
      });

      // First generation - task inherits labels
      const result1 = planningService.generatePlan({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "Implement the feature with proper handling",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
        ],
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Verify initial inheritance
      expect(result1.tasks[0]?.labels).toEqual({ product: "Initial" });

      // Modify the task labels directly (simulating user modification)
      const taskId = result1.tasks[0]!.id;
      repos.taskRepository.update(taskId, {
        labels: { product: "Modified" },
      });

      // Update issue labels
      repos.issueRepository.update(issue.id, {
        labels: { product: "New Value" },
      });

      // Regenerate plan with matching task title
      // Description is similar enough to ensure matching (same key words)
      const result2 = planningService.generatePlan({
        issueId: issue.id,
        summary: "Updated plan",
        approach: "Updated approach",
        tasks: [
          {
            id: "task-new-1",
            title: "Task 1", // Same title - will match existing
            description: "Implement the feature with proper handling",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
        ],
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Assert: Matched task should keep its modified labels (not re-inherit)
      expect(result2.tasks).toHaveLength(1);
      expect(result2.tasks[0]?.labels).toEqual({ product: "Modified" });
    });

    it("should inherit labels for new tasks added during regeneration", () => {
      // Arrange: Create issue with labels
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: ["AC 1"],
        labels: { bug: "", product: "Case Workflow" },
      });

      // First generation
      planningService.generatePlan({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First task",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
        ],
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Regenerate with additional task
      const result = planningService.generatePlan({
        issueId: issue.id,
        summary: "Updated plan",
        approach: "Updated approach",
        tasks: [
          {
            id: "task-1",
            title: "Task 1", // Matches existing
            description: "First task",
            acceptanceCriteria: ["AC 1"],
            type: "FEATURE",
          },
          {
            id: "task-2",
            title: "Task 2", // New task
            description: "Second task",
            acceptanceCriteria: ["AC 2"],
            type: "ENHANCEMENT",
          },
        ],
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      // Assert: New task should inherit labels
      expect(result.tasks).toHaveLength(2);
      const task2 = result.tasks.find((t) => t.title === "Task 2");
      expect(task2?.labels).toEqual({ bug: "", product: "Case Workflow" });
    });
  });
});

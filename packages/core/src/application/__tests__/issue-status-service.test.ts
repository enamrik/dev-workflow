/**
 * IssueStatusService Tests
 *
 * Tests for computing issue status from task states.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";
import { IssueStatusService } from "../issue-status-service.js";

describe("IssueStatusService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof getRepositories>;
  let issueStatusService: IssueStatusService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = getRepositories(testDb.client);
    issueStatusService = new IssueStatusService(testDb.client);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("computeStatus", () => {
    it("should return PLANNED for issues in PLANNED status", () => {
      const issue = createTestIssue(repos.issueRepository, {
        status: "PLANNED",
      });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("PLANNED");
      expect(result.taskCounts).toBeUndefined();
    });

    it("should return CLOSED for issues in CLOSED status", () => {
      const issue = createTestIssue(repos.issueRepository, {
        status: "CLOSED",
      });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("CLOSED");
      expect(result.taskCounts).toBeUndefined();
    });

    it("should return OPEN for issues without a plan", () => {
      const issue = createTestIssue(repos.issueRepository);

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("OPEN");
      expect(result.taskCounts).toBeUndefined();
    });

    it("should return OPEN for issues with an empty plan", () => {
      const issue = createTestIssue(repos.issueRepository);
      createTestPlan(repos.planRepository, issue.id);

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("OPEN");
      expect(result.taskCounts).toBeUndefined();
    });

    it("should return IN_PROGRESS when tasks are in progress", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "IN_PROGRESS" });
      createTestTask(repos.taskRepository, plan.id, { status: "BACKLOG" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("IN_PROGRESS");
      expect(result.taskCounts).toEqual({
        total: 2,
        completed: 0,
        inProgress: 1,
      });
    });

    it("should return TASKS_DONE when all tasks are COMPLETED", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });
      createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("TASKS_DONE");
      expect(result.taskCounts).toEqual({
        total: 2,
        completed: 2,
        inProgress: 0,
      });
    });

    it("should count ABANDONED tasks as terminal in taskCounts.completed", () => {
      // This is the key regression test for issue #227
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });
      createTestTask(repos.taskRepository, plan.id, { status: "ABANDONED" });

      const result = issueStatusService.computeStatus(issue);

      // Both COMPLETED and ABANDONED should count as "completed" (terminal)
      expect(result.taskCounts?.completed).toBe(2);
      expect(result.taskCounts?.total).toBe(2);
      // Progress should show 2/2, not 1/2
      expect(result.taskCounts?.completed).toBe(result.taskCounts?.total);
    });

    it("should return TASKS_DONE when all tasks are ABANDONED", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "ABANDONED" });
      createTestTask(repos.taskRepository, plan.id, { status: "ABANDONED" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("TASKS_DONE");
      expect(result.taskCounts).toEqual({
        total: 2,
        completed: 2, // ABANDONED counts as completed (terminal)
        inProgress: 0,
      });
    });

    it("should return TASKS_DONE when tasks are mixed COMPLETED and ABANDONED", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });
      createTestTask(repos.taskRepository, plan.id, { status: "ABANDONED" });
      createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("TASKS_DONE");
      expect(result.taskCounts).toEqual({
        total: 3,
        completed: 3, // All terminal tasks (1 ABANDONED + 2 COMPLETED)
        inProgress: 0,
      });
    });

    it("should include PR_REVIEW tasks in inProgress count", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "PR_REVIEW" });
      createTestTask(repos.taskRepository, plan.id, { status: "BACKLOG" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("IN_PROGRESS");
      expect(result.taskCounts?.inProgress).toBe(1);
    });

    it("should return OPEN when all tasks are in BACKLOG or READY", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      createTestTask(repos.taskRepository, plan.id, { status: "BACKLOG" });
      createTestTask(repos.taskRepository, plan.id, { status: "READY" });

      const result = issueStatusService.computeStatus(issue);

      expect(result.computedStatus).toBe("OPEN");
      expect(result.taskCounts?.inProgress).toBe(0);
      expect(result.taskCounts?.completed).toBe(0);
    });
  });

  describe("computeStatusFromData", () => {
    it("should count ABANDONED tasks as terminal in taskCounts.completed", () => {
      // Regression test for issue #227 using the pre-loaded data method
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task1 = createTestTask(repos.taskRepository, plan.id, { status: "COMPLETED" });
      const task2 = createTestTask(repos.taskRepository, plan.id, { status: "ABANDONED" });

      const result = issueStatusService.computeStatusFromData(issue, plan, [task1, task2]);

      // Both COMPLETED and ABANDONED should count as "completed" (terminal)
      expect(result.taskCounts?.completed).toBe(2);
      expect(result.taskCounts?.total).toBe(2);
      expect(result.computedStatus).toBe("TASKS_DONE");
    });
  });
});

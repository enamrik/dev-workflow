import { describe, it, expect } from "vitest";
import {
  isIssueInPlanning,
  isIssueClosed,
  isIssueDone,
  issueHasActiveWork,
  allTasksTerminal,
  anyTaskActive,
  computeIssueStatus,
  type Issue,
  type IssueStatus,
} from "../issue.js";
import { type Task, type TaskStatus } from "../task.js";

/**
 * Tests for table-driven IssueStatus trait functions.
 *
 * These tests ensure the trait functions correctly identify issue status properties,
 * which is critical for UI consistency and progress calculations.
 *
 * The trait-based approach hides whether status is computed or stored,
 * allowing us to switch implementations without changing consumers.
 */
describe("IssueStatus trait functions", () => {
  // Helper to create a minimal issue with a given status
  function issueWithStatus(status: IssueStatus): Issue {
    return {
      id: "test-issue-id",
      projectId: "test-project-id",
      number: 1,
      title: "Test issue",
      description: "Test description",
      type: "FEATURE",
      priority: "MEDIUM",
      status,
      acceptanceCriteria: [],
      labels: {},
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Helper to create a minimal task with a given status
  function taskWithStatus(status: TaskStatus): Task {
    return {
      id: `test-task-${status}`,
      planId: "test-plan-id",
      number: 1,
      order: 1,
      title: "Test task",
      description: "Test description",
      acceptanceCriteria: [],
      status,
      type: "TASK",
      source: "generated",
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  describe("isIssueInPlanning", () => {
    it("should return true for PLANNED status", () => {
      expect(isIssueInPlanning(issueWithStatus("PLANNED"))).toBe(true);
    });

    it("should return false for OPEN status", () => {
      expect(isIssueInPlanning(issueWithStatus("OPEN"))).toBe(false);
    });

    it("should return false for IN_PROGRESS status", () => {
      expect(isIssueInPlanning(issueWithStatus("IN_PROGRESS"))).toBe(false);
    });

    it("should return false for CLOSED status", () => {
      expect(isIssueInPlanning(issueWithStatus("CLOSED"))).toBe(false);
    });
  });

  describe("isIssueClosed", () => {
    it("should return true for CLOSED status", () => {
      expect(isIssueClosed(issueWithStatus("CLOSED"))).toBe(true);
    });

    it("should return false for PLANNED status", () => {
      expect(isIssueClosed(issueWithStatus("PLANNED"))).toBe(false);
    });

    it("should return false for OPEN status", () => {
      expect(isIssueClosed(issueWithStatus("OPEN"))).toBe(false);
    });

    it("should return false for IN_PROGRESS status", () => {
      expect(isIssueClosed(issueWithStatus("IN_PROGRESS"))).toBe(false);
    });
  });

  describe("allTasksTerminal", () => {
    it("should return true when all tasks are COMPLETED", () => {
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("COMPLETED")];
      expect(allTasksTerminal(tasks)).toBe(true);
    });

    it("should return true when all tasks are ABANDONED", () => {
      const tasks = [taskWithStatus("ABANDONED"), taskWithStatus("ABANDONED")];
      expect(allTasksTerminal(tasks)).toBe(true);
    });

    it("should return true when mix of COMPLETED and ABANDONED", () => {
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];
      expect(allTasksTerminal(tasks)).toBe(true);
    });

    it("should return false when any task is not terminal", () => {
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("IN_PROGRESS")];
      expect(allTasksTerminal(tasks)).toBe(false);
    });

    it("should return false for empty task list", () => {
      expect(allTasksTerminal([])).toBe(false);
    });
  });

  describe("anyTaskActive", () => {
    it("should return true when any task is IN_PROGRESS", () => {
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("IN_PROGRESS")];
      expect(anyTaskActive(tasks)).toBe(true);
    });

    it("should return true when any task is PR_REVIEW", () => {
      const tasks = [taskWithStatus("READY"), taskWithStatus("PR_REVIEW")];
      expect(anyTaskActive(tasks)).toBe(true);
    });

    it("should return false when no tasks are active", () => {
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("READY")];
      expect(anyTaskActive(tasks)).toBe(false);
    });

    it("should return false for empty task list", () => {
      expect(anyTaskActive([])).toBe(false);
    });
  });

  describe("isIssueDone", () => {
    it("should return true for CLOSED issue regardless of tasks", () => {
      const issue = issueWithStatus("CLOSED");
      const tasks = [taskWithStatus("IN_PROGRESS")];
      expect(isIssueDone(issue, tasks)).toBe(true);
    });

    it("should return true when all tasks are terminal", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];
      expect(isIssueDone(issue, tasks)).toBe(true);
    });

    it("should return false for PLANNED issue", () => {
      const issue = issueWithStatus("PLANNED");
      const tasks: Task[] = [];
      expect(isIssueDone(issue, tasks)).toBe(false);
    });

    it("should return false when tasks are still in progress", () => {
      const issue = issueWithStatus("IN_PROGRESS");
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("IN_PROGRESS")];
      expect(isIssueDone(issue, tasks)).toBe(false);
    });
  });

  describe("issueHasActiveWork", () => {
    it("should return true when any task is IN_PROGRESS", () => {
      const issue = issueWithStatus("IN_PROGRESS");
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("IN_PROGRESS")];
      expect(issueHasActiveWork(issue, tasks)).toBe(true);
    });

    it("should return true when any task is PR_REVIEW", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("READY"), taskWithStatus("PR_REVIEW")];
      expect(issueHasActiveWork(issue, tasks)).toBe(true);
    });

    it("should return false for PLANNED issue regardless of tasks", () => {
      const issue = issueWithStatus("PLANNED");
      const tasks = [taskWithStatus("IN_PROGRESS")];
      expect(issueHasActiveWork(issue, tasks)).toBe(false);
    });

    it("should return false for CLOSED issue regardless of tasks", () => {
      const issue = issueWithStatus("CLOSED");
      const tasks = [taskWithStatus("IN_PROGRESS")];
      expect(issueHasActiveWork(issue, tasks)).toBe(false);
    });

    it("should return false when no tasks are active", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("READY")];
      expect(issueHasActiveWork(issue, tasks)).toBe(false);
    });
  });

  describe("computeIssueStatus", () => {
    it("should return PLANNED for PLANNED issue", () => {
      const issue = issueWithStatus("PLANNED");
      expect(computeIssueStatus(issue, [])).toBe("PLANNED");
    });

    it("should return CLOSED for CLOSED issue", () => {
      const issue = issueWithStatus("CLOSED");
      const tasks = [taskWithStatus("IN_PROGRESS")]; // Tasks don't matter
      expect(computeIssueStatus(issue, tasks)).toBe("CLOSED");
    });

    it("should return OPEN when no tasks exist", () => {
      const issue = issueWithStatus("OPEN");
      expect(computeIssueStatus(issue, [])).toBe("OPEN");
    });

    it("should return TASKS_DONE when all tasks are terminal", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];
      expect(computeIssueStatus(issue, tasks)).toBe("TASKS_DONE");
    });

    it("should return IN_PROGRESS when any task is active", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("IN_PROGRESS")];
      expect(computeIssueStatus(issue, tasks)).toBe("IN_PROGRESS");
    });

    it("should return OPEN when tasks exist but none are active", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("BACKLOG"), taskWithStatus("READY")];
      expect(computeIssueStatus(issue, tasks)).toBe("OPEN");
    });
  });

  describe("trait consistency", () => {
    const allStatuses: IssueStatus[] = ["PLANNED", "OPEN", "IN_PROGRESS", "CLOSED"];

    it("planning and closed should be mutually exclusive", () => {
      for (const status of allStatuses) {
        const issue = issueWithStatus(status);
        if (isIssueInPlanning(issue)) {
          expect(isIssueClosed(issue)).toBe(false);
        }
      }
    });

    it("closed issues should always be considered done", () => {
      const issue = issueWithStatus("CLOSED");
      const tasks = [taskWithStatus("IN_PROGRESS")]; // Even with active tasks
      expect(isIssueDone(issue, tasks)).toBe(true);
    });

    it("planned issues should never have active work", () => {
      const issue = issueWithStatus("PLANNED");
      const tasks = [taskWithStatus("IN_PROGRESS")];
      expect(issueHasActiveWork(issue, tasks)).toBe(false);
    });
  });

  describe("use in filter operations", () => {
    it("should work correctly with Array.filter for milestone progress", () => {
      const issues = [
        issueWithStatus("CLOSED"),
        issueWithStatus("OPEN"),
        issueWithStatus("IN_PROGRESS"),
        issueWithStatus("PLANNED"),
      ];

      // This is the pattern used in milestone-tools.ts
      const closedCount = issues.filter(isIssueClosed).length;
      expect(closedCount).toBe(1);

      // Active issues: not closed and not in planning
      const activeCount = issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i)).length;
      expect(activeCount).toBe(2); // OPEN + IN_PROGRESS
    });

    it("should work for checking if all work is done", () => {
      const issue = issueWithStatus("OPEN");
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];

      // This pattern is used in IssueStatusService
      const computedStatus = computeIssueStatus(issue, tasks);
      expect(computedStatus).toBe("TASKS_DONE");
      expect(isIssueDone(issue, tasks)).toBe(true);
    });
  });

  describe("bug #227 regression test", () => {
    it("should count ABANDONED tasks as terminal for progress calculation", () => {
      const issue = issueWithStatus("IN_PROGRESS");
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];

      // This was the bug: ABANDONED wasn't counted as terminal
      expect(allTasksTerminal(tasks)).toBe(true);
      expect(computeIssueStatus(issue, tasks)).toBe("TASKS_DONE");
    });

    it("should show progress as 2/2 not 1/2 when one task completed and one abandoned", () => {
      const tasks = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];

      // This is what the UI should show for progress
      const terminalCount = tasks.filter(
        (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
      ).length;
      expect(terminalCount).toBe(2);
      expect(`${terminalCount}/${tasks.length}`).toBe("2/2");
    });
  });
});

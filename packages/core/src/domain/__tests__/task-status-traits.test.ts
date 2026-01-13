import { describe, it, expect } from "vitest";
import { isTerminal, isWorkable, isActive, type Task, type TaskStatus } from "../task.js";

/**
 * Tests for table-driven TaskStatus trait functions.
 *
 * These tests ensure the trait functions correctly identify status properties,
 * which is critical for progress calculations and UI consistency.
 */
describe("TaskStatus trait functions", () => {
  // Helper to create a minimal task with a given status
  function taskWithStatus(status: TaskStatus): Task {
    return {
      id: "test-task-id",
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

  describe("isTerminal", () => {
    it("should return true for COMPLETED status", () => {
      expect(isTerminal(taskWithStatus("COMPLETED"))).toBe(true);
    });

    it("should return true for ABANDONED status", () => {
      expect(isTerminal(taskWithStatus("ABANDONED"))).toBe(true);
    });

    it("should return false for PLANNED status", () => {
      expect(isTerminal(taskWithStatus("PLANNED"))).toBe(false);
    });

    it("should return false for BACKLOG status", () => {
      expect(isTerminal(taskWithStatus("BACKLOG"))).toBe(false);
    });

    it("should return false for READY status", () => {
      expect(isTerminal(taskWithStatus("READY"))).toBe(false);
    });

    it("should return false for IN_PROGRESS status", () => {
      expect(isTerminal(taskWithStatus("IN_PROGRESS"))).toBe(false);
    });

    it("should return false for PR_REVIEW status", () => {
      expect(isTerminal(taskWithStatus("PR_REVIEW"))).toBe(false);
    });
  });

  describe("isWorkable", () => {
    it("should return true for BACKLOG status", () => {
      expect(isWorkable(taskWithStatus("BACKLOG"))).toBe(true);
    });

    it("should return true for READY status", () => {
      expect(isWorkable(taskWithStatus("READY"))).toBe(true);
    });

    it("should return true for IN_PROGRESS status", () => {
      expect(isWorkable(taskWithStatus("IN_PROGRESS"))).toBe(true);
    });

    it("should return false for PLANNED status", () => {
      expect(isWorkable(taskWithStatus("PLANNED"))).toBe(false);
    });

    it("should return false for PR_REVIEW status", () => {
      expect(isWorkable(taskWithStatus("PR_REVIEW"))).toBe(false);
    });

    it("should return false for COMPLETED status", () => {
      expect(isWorkable(taskWithStatus("COMPLETED"))).toBe(false);
    });

    it("should return false for ABANDONED status", () => {
      expect(isWorkable(taskWithStatus("ABANDONED"))).toBe(false);
    });
  });

  describe("isActive", () => {
    it("should return true for IN_PROGRESS status", () => {
      expect(isActive(taskWithStatus("IN_PROGRESS"))).toBe(true);
    });

    it("should return true for PR_REVIEW status", () => {
      expect(isActive(taskWithStatus("PR_REVIEW"))).toBe(true);
    });

    it("should return false for PLANNED status", () => {
      expect(isActive(taskWithStatus("PLANNED"))).toBe(false);
    });

    it("should return false for BACKLOG status", () => {
      expect(isActive(taskWithStatus("BACKLOG"))).toBe(false);
    });

    it("should return false for READY status", () => {
      expect(isActive(taskWithStatus("READY"))).toBe(false);
    });

    it("should return false for COMPLETED status", () => {
      expect(isActive(taskWithStatus("COMPLETED"))).toBe(false);
    });

    it("should return false for ABANDONED status", () => {
      expect(isActive(taskWithStatus("ABANDONED"))).toBe(false);
    });
  });

  describe("trait consistency", () => {
    const allStatuses: TaskStatus[] = [
      "PLANNED",
      "BACKLOG",
      "READY",
      "IN_PROGRESS",
      "PR_REVIEW",
      "COMPLETED",
      "ABANDONED",
    ];

    it("terminal and workable should be mutually exclusive", () => {
      for (const status of allStatuses) {
        const task = taskWithStatus(status);
        if (isTerminal(task)) {
          expect(isWorkable(task)).toBe(false);
        }
      }
    });

    it("terminal and active should be mutually exclusive", () => {
      for (const status of allStatuses) {
        const task = taskWithStatus(status);
        if (isTerminal(task)) {
          expect(isActive(task)).toBe(false);
        }
      }
    });

    it("active tasks should be a subset of workable or PR_REVIEW", () => {
      for (const status of allStatuses) {
        const task = taskWithStatus(status);
        if (isActive(task)) {
          // Active means work is happening - either workable (IN_PROGRESS) or PR_REVIEW
          const isActiveValid = isWorkable(task) || status === "PR_REVIEW";
          expect(isActiveValid).toBe(true);
        }
      }
    });
  });

  describe("use in filter operations", () => {
    it("should work correctly with Array.filter for progress calculation", () => {
      const tasks = [
        taskWithStatus("COMPLETED"),
        taskWithStatus("ABANDONED"),
        taskWithStatus("IN_PROGRESS"),
        taskWithStatus("BACKLOG"),
      ];

      // This is the pattern used in WorkQueueRibbon.tsx and other progress displays
      const terminalCount = tasks.filter(isTerminal).length;
      expect(terminalCount).toBe(2); // COMPLETED + ABANDONED

      const activeCount = tasks.filter(isActive).length;
      expect(activeCount).toBe(1); // IN_PROGRESS only

      // Progress should show 2/4 (terminal tasks / total tasks)
      expect(`${terminalCount}/${tasks.length}`).toBe("2/4");
    });

    it("should correctly identify TASKS_DONE state (all terminal)", () => {
      const allTerminal = [taskWithStatus("COMPLETED"), taskWithStatus("ABANDONED")];

      const terminalCount = allTerminal.filter(isTerminal).length;
      const isTasksDone = terminalCount === allTerminal.length;

      expect(isTasksDone).toBe(true);
    });

    it("should correctly identify when no work is active", () => {
      const noActiveWork = [taskWithStatus("BACKLOG"), taskWithStatus("READY")];

      const activeCount = noActiveWork.filter(isActive).length;
      expect(activeCount).toBe(0);
    });
  });
});

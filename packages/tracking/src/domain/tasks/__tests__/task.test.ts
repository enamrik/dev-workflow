/**
 * Tests for Task domain class
 *
 * Verifies declaration-merged Task class behavior:
 * - Task.from() hydration
 * - Instance getters (isTerminal, isWorkable, isActive)
 * - checkTransition() for valid/invalid transitions
 * - canSubmitForReview(), canComplete(), canAbandon(), canDelete()
 * - allowedTransitions getter
 * - JSON serialization (no methods in output)
 */

import { describe, it, expect } from "vitest";
import { Task, type TaskData, type TaskStatus } from "../task.js";

// =============================================================================
// Test Helpers
// =============================================================================

function makeTask(overrides: Partial<TaskData> = {}): Task {
  return Task.from({
    id: "test-id",
    planId: "plan-1",
    number: 1,
    order: 1,
    title: "Test task",
    description: "Test description",
    acceptanceCriteria: [],
    status: "PLANNED",
    type: "TASK",
    source: "generated",
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });
}

// =============================================================================
// Task.from()
// =============================================================================

describe("Task.from()", () => {
  it("should create a Task instance with all fields preserved", () => {
    const task = makeTask({
      id: "abc-123",
      title: "My task",
      status: "IN_PROGRESS",
      prUrl: "https://github.com/example/repo/pull/1",
    });

    expect(task.id).toBe("abc-123");
    expect(task.title).toBe("My task");
    expect(task.status).toBe("IN_PROGRESS");
    expect(task.prUrl).toBe("https://github.com/example/repo/pull/1");
    expect(task.planId).toBe("plan-1");
    expect(task.number).toBe(1);
    expect(task.acceptanceCriteria).toEqual([]);
    expect(task.isDeleted).toBe(false);
  });

  it("should create an instance that passes instanceof check", () => {
    const task = makeTask();
    expect(task).toBeInstanceOf(Task);
  });

  it("should produce clean JSON (no methods serialized)", () => {
    const task = makeTask({ status: "COMPLETED" });
    const json = JSON.parse(JSON.stringify(task));

    // Data fields should be present
    expect(json.id).toBe("test-id");
    expect(json.status).toBe("COMPLETED");

    // Class methods/getters should NOT be in JSON
    expect(json.isTerminal).toBeUndefined();
    expect(json.isWorkable).toBeUndefined();
    expect(json.isActive).toBeUndefined();
    expect(json.allowedTransitions).toBeUndefined();
    expect(json.checkTransition).toBeUndefined();
    expect(json.canSubmitForReview).toBeUndefined();
    expect(json.canComplete).toBeUndefined();
    expect(json.canAbandon).toBeUndefined();
    expect(json.canDelete).toBeUndefined();
  });

  it("should preserve optional fields when provided", () => {
    const task = makeTask({
      estimatedMinutes: 30,
      worktreePath: "/tmp/worktree",
      branchName: "feature/test",
      prUrl: "https://github.com/example/repo/pull/5",
      prNumber: 5,
      prStatus: "OPEN",
      labels: { bug: "", priority: "high" },
      dependsOn: ["task-2", "task-3"],
    });

    expect(task.estimatedMinutes).toBe(30);
    expect(task.worktreePath).toBe("/tmp/worktree");
    expect(task.branchName).toBe("feature/test");
    expect(task.prUrl).toBe("https://github.com/example/repo/pull/5");
    expect(task.prNumber).toBe(5);
    expect(task.prStatus).toBe("OPEN");
    expect(task.labels).toEqual({ bug: "", priority: "high" });
    expect(task.dependsOn).toEqual(["task-2", "task-3"]);
  });
});

// =============================================================================
// Status Trait Getters
// =============================================================================

describe("isTerminal", () => {
  const terminalStatuses: TaskStatus[] = ["COMPLETED", "ABANDONED"];
  const nonTerminalStatuses: TaskStatus[] = [
    "PLANNED",
    "BACKLOG",
    "READY",
    "IN_PROGRESS",
    "PR_REVIEW",
  ];

  for (const status of terminalStatuses) {
    it(`should return true for ${status}`, () => {
      expect(makeTask({ status }).isTerminal).toBe(true);
    });
  }

  for (const status of nonTerminalStatuses) {
    it(`should return false for ${status}`, () => {
      expect(makeTask({ status }).isTerminal).toBe(false);
    });
  }
});

describe("isWorkable", () => {
  const workableStatuses: TaskStatus[] = ["BACKLOG", "READY", "IN_PROGRESS"];
  const nonWorkableStatuses: TaskStatus[] = ["PLANNED", "PR_REVIEW", "COMPLETED", "ABANDONED"];

  for (const status of workableStatuses) {
    it(`should return true for ${status}`, () => {
      expect(makeTask({ status }).isWorkable).toBe(true);
    });
  }

  for (const status of nonWorkableStatuses) {
    it(`should return false for ${status}`, () => {
      expect(makeTask({ status }).isWorkable).toBe(false);
    });
  }
});

describe("isActive", () => {
  const activeStatuses: TaskStatus[] = ["IN_PROGRESS", "PR_REVIEW"];
  const inactiveStatuses: TaskStatus[] = ["PLANNED", "BACKLOG", "READY", "COMPLETED", "ABANDONED"];

  for (const status of activeStatuses) {
    it(`should return true for ${status}`, () => {
      expect(makeTask({ status }).isActive).toBe(true);
    });
  }

  for (const status of inactiveStatuses) {
    it(`should return false for ${status}`, () => {
      expect(makeTask({ status }).isActive).toBe(false);
    });
  }
});

// =============================================================================
// allowedTransitions
// =============================================================================

describe("allowedTransitions", () => {
  it("should return [BACKLOG, ABANDONED] for PLANNED", () => {
    expect(makeTask({ status: "PLANNED" }).allowedTransitions).toEqual(["BACKLOG", "ABANDONED"]);
  });

  it("should return [READY, IN_PROGRESS, ABANDONED] for BACKLOG", () => {
    expect(makeTask({ status: "BACKLOG" }).allowedTransitions).toEqual([
      "READY",
      "IN_PROGRESS",
      "ABANDONED",
    ]);
  });

  it("should return [BACKLOG, IN_PROGRESS, ABANDONED] for READY", () => {
    expect(makeTask({ status: "READY" }).allowedTransitions).toEqual([
      "BACKLOG",
      "IN_PROGRESS",
      "ABANDONED",
    ]);
  });

  it("should return [PR_REVIEW, COMPLETED, ABANDONED] for IN_PROGRESS", () => {
    expect(makeTask({ status: "IN_PROGRESS" }).allowedTransitions).toEqual([
      "PR_REVIEW",
      "COMPLETED",
      "ABANDONED",
    ]);
  });

  it("should return [COMPLETED, ABANDONED] for PR_REVIEW", () => {
    expect(makeTask({ status: "PR_REVIEW" }).allowedTransitions).toEqual([
      "COMPLETED",
      "ABANDONED",
    ]);
  });

  it("should return empty array for COMPLETED", () => {
    expect(makeTask({ status: "COMPLETED" }).allowedTransitions).toEqual([]);
  });

  it("should return empty array for ABANDONED", () => {
    expect(makeTask({ status: "ABANDONED" }).allowedTransitions).toEqual([]);
  });

  it("should return a new array each time (not a reference)", () => {
    const task = makeTask({ status: "BACKLOG" });
    const transitions1 = task.allowedTransitions;
    const transitions2 = task.allowedTransitions;
    expect(transitions1).not.toBe(transitions2);
    expect(transitions1).toEqual(transitions2);
  });
});

// =============================================================================
// checkTransition()
// =============================================================================

describe("checkTransition()", () => {
  it("should allow same-status transition (no-op)", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const result = task.checkTransition("IN_PROGRESS");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow valid transitions", () => {
    const validCases: Array<[TaskStatus, TaskStatus]> = [
      ["PLANNED", "BACKLOG"],
      ["PLANNED", "ABANDONED"],
      ["BACKLOG", "READY"],
      ["BACKLOG", "IN_PROGRESS"],
      ["BACKLOG", "ABANDONED"],
      ["READY", "BACKLOG"],
      ["READY", "IN_PROGRESS"],
      ["READY", "ABANDONED"],
      ["IN_PROGRESS", "PR_REVIEW"],
      ["IN_PROGRESS", "COMPLETED"],
      ["IN_PROGRESS", "ABANDONED"],
      ["PR_REVIEW", "COMPLETED"],
      ["PR_REVIEW", "ABANDONED"],
    ];

    for (const [from, to] of validCases) {
      const result = makeTask({ status: from }).checkTransition(to);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    }
  });

  it("should reject invalid transitions with reason", () => {
    const task = makeTask({ status: "PLANNED" });
    const result = task.checkTransition("COMPLETED");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot transition from PLANNED to COMPLETED");
    expect(result.reason).toContain("BACKLOG");
    expect(result.reason).toContain("ABANDONED");
  });

  it("should reject transitions from terminal states", () => {
    const completed = makeTask({ status: "COMPLETED" });
    const result = completed.checkTransition("IN_PROGRESS");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot transition from COMPLETED to IN_PROGRESS");
    expect(result.reason).toContain("Allowed: [none]");
  });

  it("should reject transitions from ABANDONED", () => {
    const abandoned = makeTask({ status: "ABANDONED" });
    const result = abandoned.checkTransition("BACKLOG");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Allowed: [none]");
  });
});

// =============================================================================
// canSubmitForReview()
// =============================================================================

describe("canSubmitForReview()", () => {
  it("should allow when IN_PROGRESS with prUrl", () => {
    const task = makeTask({
      status: "IN_PROGRESS",
      prUrl: "https://github.com/example/repo/pull/1",
    });
    const result = task.canSubmitForReview();
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should reject when IN_PROGRESS without prUrl", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const result = task.canSubmitForReview();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("without a PR");
  });

  it("should reject when not IN_PROGRESS", () => {
    const task = makeTask({ status: "BACKLOG" });
    const result = task.canSubmitForReview();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in BACKLOG status");
  });

  it("should reject when COMPLETED (terminal)", () => {
    const task = makeTask({ status: "COMPLETED" });
    const result = task.canSubmitForReview();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in COMPLETED status");
  });

  it("should reject when PR_REVIEW even with prUrl", () => {
    const task = makeTask({
      status: "PR_REVIEW",
      prUrl: "https://github.com/example/repo/pull/1",
    });
    const result = task.canSubmitForReview();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in PR_REVIEW status");
  });
});

// =============================================================================
// canComplete()
// =============================================================================

describe("canComplete()", () => {
  it("should allow when IN_PROGRESS", () => {
    const task = makeTask({ status: "IN_PROGRESS" });
    const result = task.canComplete();
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow when PR_REVIEW", () => {
    const task = makeTask({ status: "PR_REVIEW" });
    const result = task.canComplete();
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should reject when PLANNED", () => {
    const task = makeTask({ status: "PLANNED" });
    const result = task.canComplete();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in PLANNED status");
  });

  it("should reject when BACKLOG", () => {
    const task = makeTask({ status: "BACKLOG" });
    const result = task.canComplete();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in BACKLOG status");
  });

  it("should reject when already COMPLETED", () => {
    const task = makeTask({ status: "COMPLETED" });
    const result = task.canComplete();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in COMPLETED status");
  });

  it("should reject when ABANDONED", () => {
    const task = makeTask({ status: "ABANDONED" });
    const result = task.canComplete();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task is in ABANDONED status");
  });
});

// =============================================================================
// canAbandon()
// =============================================================================

describe("canAbandon()", () => {
  const nonTerminalStatuses: TaskStatus[] = [
    "PLANNED",
    "BACKLOG",
    "READY",
    "IN_PROGRESS",
    "PR_REVIEW",
  ];

  for (const status of nonTerminalStatuses) {
    it(`should allow when ${status}`, () => {
      const task = makeTask({ status });
      const result = task.canAbandon();
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }

  it("should reject when COMPLETED", () => {
    const task = makeTask({ status: "COMPLETED" });
    const result = task.canAbandon();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("already in terminal state COMPLETED");
  });

  it("should reject when ABANDONED", () => {
    const task = makeTask({ status: "ABANDONED" });
    const result = task.canAbandon();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("already in terminal state ABANDONED");
  });

  it("should allow when requesting session owns the task", () => {
    const task = makeTask({ status: "IN_PROGRESS", sessionId: "session-abc" });
    const result = task.canAbandon("session-abc");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should reject when requesting session does not own the task", () => {
    const task = makeTask({ status: "IN_PROGRESS", sessionId: "session-abc" });
    const result = task.canAbandon("session-xyz");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not associated with session session-xyz");
  });

  it("should reject when task has no session and a session is supplied", () => {
    const task = makeTask({ status: "PLANNED" });
    const result = task.canAbandon("invalid-session");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not associated with session invalid-session");
  });

  it("should bypass ownership check with force=true", () => {
    const task = makeTask({ status: "IN_PROGRESS", sessionId: "session-abc" });
    const result = task.canAbandon("session-xyz", true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// =============================================================================
// canDelete()
// =============================================================================

describe("canDelete()", () => {
  const deletableStatuses: TaskStatus[] = ["PLANNED", "BACKLOG", "READY"];
  const nonDeletableStatuses: TaskStatus[] = ["IN_PROGRESS", "PR_REVIEW", "COMPLETED", "ABANDONED"];

  for (const status of deletableStatuses) {
    it(`should allow when ${status}`, () => {
      const task = makeTask({ status });
      const result = task.canDelete();
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }

  for (const status of nonDeletableStatuses) {
    it(`should reject when ${status}`, () => {
      const task = makeTask({ status });
      const result = task.canDelete();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(`Cannot delete task with status ${status}`);
    });
  }
});

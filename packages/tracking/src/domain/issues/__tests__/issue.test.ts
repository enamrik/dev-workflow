/**
 * Tests for Issue domain class
 *
 * Verifies declaration-merged Issue class behavior:
 * - Issue.from() hydration
 * - Instance getters (isClosed, isInPlanning)
 * - Static methods (allTerminal, anyActive, computeStatus)
 * - checkCanClose() domain logic
 */

import { describe, it, expect } from "vitest";
import { Issue } from "../issue.js";
import { Task } from "../../tasks/task.js";
import type { ComputedIssueStatus, IssueData, IssueStatus } from "../issue.js";

// =============================================================================
// Test Helpers
// =============================================================================

function makeIssue(overrides: Partial<IssueData> = {}): Issue {
  return Issue.from({
    id: "test-id",
    projectId: "project-1",
    number: 1,
    title: "Test issue",
    description: "Test description",
    acceptanceCriteria: [],
    type: "TASK",
    priority: "MEDIUM",
    status: "OPEN",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });
}

/**
 * Create a Task instance for testing Issue's static methods.
 * Uses Task.from() to get the class prototype (needed for isTerminal/isActive getters).
 */
function makeTaskLike(overrides: Partial<{ status: string }> = {}): Task {
  return Task.from({
    id: "task-1",
    planId: "plan-1",
    number: 1,
    order: 1,
    title: "Test task",
    description: "Test task description",
    acceptanceCriteria: [],
    status: "COMPLETED",
    type: "TASK",
    source: "generated",
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  } as unknown as Task);
}

// =============================================================================
// Issue.from()
// =============================================================================

describe("Issue.from()", () => {
  it("should create an Issue instance with all fields preserved", () => {
    const data: IssueData = {
      id: "abc-123",
      projectId: "proj-1",
      number: 42,
      title: "My title",
      description: "My description",
      acceptanceCriteria: ["AC1", "AC2"],
      type: "BUG",
      priority: "HIGH",
      status: "OPEN",
      templateUsed: "bug-template",
      createdBy: "user-1",
      createdAt: "2024-06-15T10:00:00Z",
      updatedAt: "2024-06-15T12:00:00Z",
      milestoneId: "ms-1",
      sourceExternalId: "ext-99",
      labels: { bug: "", severity: "high" },
      isDeleted: false,
      deletedAt: undefined,
      deletedBy: undefined,
    };

    const issue = Issue.from(data);

    expect(issue.id).toBe("abc-123");
    expect(issue.projectId).toBe("proj-1");
    expect(issue.number).toBe(42);
    expect(issue.title).toBe("My title");
    expect(issue.description).toBe("My description");
    expect(issue.acceptanceCriteria).toEqual(["AC1", "AC2"]);
    expect(issue.type).toBe("BUG");
    expect(issue.priority).toBe("HIGH");
    expect(issue.status).toBe("OPEN");
    expect(issue.templateUsed).toBe("bug-template");
    expect(issue.createdBy).toBe("user-1");
    expect(issue.createdAt).toBe("2024-06-15T10:00:00Z");
    expect(issue.updatedAt).toBe("2024-06-15T12:00:00Z");
    expect(issue.milestoneId).toBe("ms-1");
    expect(issue.sourceExternalId).toBe("ext-99");
    expect(issue.labels).toEqual({ bug: "", severity: "high" });
  });

  it("should return an instance of Issue", () => {
    const issue = makeIssue();
    expect(issue).toBeInstanceOf(Issue);
  });

  it("should produce clean JSON with no methods", () => {
    const issue = makeIssue({ title: "Serialize me" });
    const json = JSON.parse(JSON.stringify(issue));

    // Data fields should be present
    expect(json.title).toBe("Serialize me");
    expect(json.status).toBe("OPEN");
    expect(json.id).toBe("test-id");

    // Class methods and getters should NOT appear in JSON
    expect(json.isClosed).toBeUndefined();
    expect(json.isInPlanning).toBeUndefined();
    expect(json.checkCanClose).toBeUndefined();
  });
});

// =============================================================================
// isClosed getter
// =============================================================================

describe("issue.isClosed", () => {
  const testCases: Array<{ status: IssueStatus; expected: boolean }> = [
    { status: "PLANNED", expected: false },
    { status: "OPEN", expected: false },
    { status: "IN_PROGRESS", expected: false },
    { status: "CLOSED", expected: true },
  ];

  for (const { status, expected } of testCases) {
    it(`should return ${expected} for status ${status}`, () => {
      const issue = makeIssue({ status });
      expect(issue.isClosed).toBe(expected);
    });
  }
});

// =============================================================================
// isInPlanning getter
// =============================================================================

describe("issue.isInPlanning", () => {
  const testCases: Array<{ status: IssueStatus; expected: boolean }> = [
    { status: "PLANNED", expected: true },
    { status: "OPEN", expected: false },
    { status: "IN_PROGRESS", expected: false },
    { status: "CLOSED", expected: false },
  ];

  for (const { status, expected } of testCases) {
    it(`should return ${expected} for status ${status}`, () => {
      const issue = makeIssue({ status });
      expect(issue.isInPlanning).toBe(expected);
    });
  }
});

// =============================================================================
// Issue.allTerminal()
// =============================================================================

describe("Issue.allTerminal()", () => {
  it("should return false for empty array", () => {
    expect(Issue.allTerminal([])).toBe(false);
  });

  it("should return true when all tasks are terminal", () => {
    const tasks = [
      makeTaskLike({ status: "COMPLETED" }),
      makeTaskLike({ status: "ABANDONED" }),
      makeTaskLike({ status: "COMPLETED" }),
    ];
    expect(Issue.allTerminal(tasks)).toBe(true);
  });

  it("should return false when some tasks are not terminal", () => {
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.allTerminal(tasks)).toBe(false);
  });

  it("should return false when all tasks are non-terminal", () => {
    const tasks = [makeTaskLike({ status: "BACKLOG" }), makeTaskLike({ status: "READY" })];
    expect(Issue.allTerminal(tasks)).toBe(false);
  });
});

// =============================================================================
// Issue.anyActive()
// =============================================================================

describe("Issue.anyActive()", () => {
  it("should return false when no tasks are active", () => {
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "BACKLOG" })];
    expect(Issue.anyActive(tasks)).toBe(false);
  });

  it("should return true when some tasks are IN_PROGRESS", () => {
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.anyActive(tasks)).toBe(true);
  });

  it("should return true when some tasks are in PR_REVIEW", () => {
    const tasks = [makeTaskLike({ status: "BACKLOG" }), makeTaskLike({ status: "PR_REVIEW" })];
    expect(Issue.anyActive(tasks)).toBe(true);
  });

  it("should return false for empty array", () => {
    expect(Issue.anyActive([])).toBe(false);
  });
});

// =============================================================================
// Issue.computeStatus()
// =============================================================================

describe("Issue.computeStatus()", () => {
  it("should return PLANNED for a PLANNED issue regardless of tasks", () => {
    const issue = makeIssue({ status: "PLANNED" });
    const tasks = [makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("PLANNED");
  });

  it("should return CLOSED for a CLOSED issue regardless of tasks", () => {
    const issue = makeIssue({ status: "CLOSED" });
    const tasks = [makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("CLOSED");
  });

  it("should return OPEN for an open issue with no tasks", () => {
    const issue = makeIssue({ status: "OPEN" });
    expect(Issue.computeStatus(issue, [])).toBe("OPEN");
  });

  it("should return TASKS_DONE when all tasks are terminal", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "ABANDONED" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("TASKS_DONE");
  });

  it("should return IN_PROGRESS when any task is active", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("IN_PROGRESS");
  });

  it("should return OPEN for an open issue with non-active, non-terminal tasks", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "BACKLOG" }), makeTaskLike({ status: "READY" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("OPEN");
  });

  it("should handle IN_PROGRESS stored status with tasks", () => {
    const issue = makeIssue({ status: "IN_PROGRESS" });
    const tasks = [makeTaskLike({ status: "IN_PROGRESS" })];
    expect(Issue.computeStatus(issue, tasks)).toBe("IN_PROGRESS");
  });

  const allStatuses: Array<{ stored: IssueStatus; tasks: Task[]; expected: ComputedIssueStatus }> =
    [
      { stored: "PLANNED", tasks: [], expected: "PLANNED" },
      { stored: "CLOSED", tasks: [], expected: "CLOSED" },
      { stored: "OPEN", tasks: [], expected: "OPEN" },
      { stored: "IN_PROGRESS", tasks: [], expected: "OPEN" },
    ];

  for (const { stored, tasks, expected } of allStatuses) {
    it(`should return ${expected} for stored ${stored} with empty tasks`, () => {
      const issue = makeIssue({ status: stored });
      expect(Issue.computeStatus(issue, tasks)).toBe(expected);
    });
  }
});

// =============================================================================
// Issue.isDoneStatus()
// =============================================================================

describe("Issue.isDoneStatus()", () => {
  const testCases: Array<{ status: ComputedIssueStatus; expected: boolean }> = [
    { status: "PLANNED", expected: false },
    { status: "OPEN", expected: false },
    { status: "IN_PROGRESS", expected: false },
    { status: "TASKS_DONE", expected: true },
    { status: "CLOSED", expected: true },
  ];

  for (const { status, expected } of testCases) {
    it(`should return ${expected} for ${status}`, () => {
      expect(Issue.isDoneStatus(status)).toBe(expected);
    });
  }

  it("treats an OPEN issue whose tasks are all terminal as done (TASKS_DONE)", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "ABANDONED" })];
    expect(Issue.isDoneStatus(Issue.computeStatus(issue, tasks))).toBe(true);
  });

  it("treats an OPEN issue with available (BACKLOG/READY) tasks as not done", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "READY" }), makeTaskLike({ status: "BACKLOG" })];
    expect(Issue.isDoneStatus(Issue.computeStatus(issue, tasks))).toBe(false);
  });
});

// =============================================================================
// checkCanClose()
// =============================================================================

describe("issue.checkCanClose()", () => {
  it("should reject if issue is already closed", () => {
    const issue = makeIssue({ status: "CLOSED" });
    const result = issue.checkCanClose([], false);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Issue is already closed");
  });

  it("should reject if tasks are incomplete and force is false", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "IN_PROGRESS" })];
    const result = issue.checkCanClose(tasks, false);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Issue has incomplete tasks. Use force=true to close anyway.");
  });

  it("should allow if tasks are incomplete but force is true", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "IN_PROGRESS" })];
    const result = issue.checkCanClose(tasks, true);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow if all tasks are terminal", () => {
    const issue = makeIssue({ status: "OPEN" });
    const tasks = [makeTaskLike({ status: "COMPLETED" }), makeTaskLike({ status: "ABANDONED" })];
    const result = issue.checkCanClose(tasks, false);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow if there are no tasks", () => {
    const issue = makeIssue({ status: "OPEN" });
    const result = issue.checkCanClose([], false);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow closing a PLANNED issue with no tasks", () => {
    const issue = makeIssue({ status: "PLANNED" });
    const result = issue.checkCanClose([], false);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow closing an IN_PROGRESS issue with all tasks terminal", () => {
    const issue = makeIssue({ status: "IN_PROGRESS" });
    const tasks = [makeTaskLike({ status: "COMPLETED" })];
    const result = issue.checkCanClose(tasks, false);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

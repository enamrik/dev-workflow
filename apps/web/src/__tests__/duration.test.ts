import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatDuration,
  getTaskDuration,
  getTaskTimingMessage,
  getTimeInCurrentStatus,
  getTaskAgeColorClass,
} from "../lib/duration";

describe("formatDuration", () => {
  it("returns '<1m' for durations less than a minute", () => {
    expect(formatDuration(0)).toBe("<1m");
    expect(formatDuration(30000)).toBe("<1m"); // 30 seconds
    expect(formatDuration(59999)).toBe("<1m"); // 59.999 seconds
  });

  it("returns '0m' for negative durations", () => {
    expect(formatDuration(-1000)).toBe("0m");
  });

  it("formats minutes correctly", () => {
    expect(formatDuration(60000)).toBe("1m"); // 1 minute
    expect(formatDuration(120000)).toBe("2m"); // 2 minutes
    expect(formatDuration(3540000)).toBe("59m"); // 59 minutes
  });

  it("formats hours and minutes correctly", () => {
    expect(formatDuration(3600000)).toBe("1h"); // 1 hour exactly
    expect(formatDuration(5400000)).toBe("1h 30m"); // 1.5 hours
    expect(formatDuration(7200000)).toBe("2h"); // 2 hours exactly
    expect(formatDuration(9000000)).toBe("2h 30m"); // 2.5 hours
  });

  it("formats days and hours correctly", () => {
    expect(formatDuration(86400000)).toBe("1d"); // 1 day exactly
    expect(formatDuration(90000000)).toBe("1d 1h"); // 1 day 1 hour
    expect(formatDuration(172800000)).toBe("2d"); // 2 days exactly
    expect(formatDuration(180000000)).toBe("2d 2h"); // 2 days 2 hours
  });

  it("handles multi-day durations", () => {
    expect(formatDuration(259200000)).toBe("3d"); // 3 days
    expect(formatDuration(604800000)).toBe("7d"); // 7 days
  });
});

describe("getTaskDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for tasks without startedAt", () => {
    expect(getTaskDuration({ status: "BACKLOG" })).toBeNull();
    expect(getTaskDuration({ status: "IN_PROGRESS" })).toBeNull();
  });

  it("calculates duration for completed tasks", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-15T10:00:00Z",
      completedAt: "2024-01-15T11:30:00Z",
    };
    expect(getTaskDuration(task)).toBe(5400000); // 1.5 hours
  });

  it("calculates duration for abandoned tasks", () => {
    const task = {
      status: "ABANDONED",
      startedAt: "2024-01-15T10:00:00Z",
      abandonedAt: "2024-01-15T10:45:00Z",
    };
    expect(getTaskDuration(task)).toBe(2700000); // 45 minutes
  });

  it("calculates elapsed time for in-progress tasks", () => {
    const task = {
      status: "IN_PROGRESS",
      startedAt: "2024-01-15T10:00:00Z",
    };
    // Current time is 12:00, started at 10:00 = 2 hours
    expect(getTaskDuration(task)).toBe(7200000);
  });

  it("returns null for completed tasks without completedAt", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskDuration(task)).toBeNull();
  });
});

describe("getTaskTimingMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns duration for backlog tasks with createdAt", () => {
    const task = {
      status: "BACKLOG",
      createdAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("2h");
  });

  it("returns duration for ready tasks with createdAt", () => {
    const task = {
      status: "READY",
      createdAt: "2024-01-14T12:00:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("1d");
  });

  it("returns null for backlog tasks without createdAt", () => {
    expect(getTaskTimingMessage({ status: "BACKLOG" })).toBeNull();
  });

  it("returns just duration for in-progress tasks", () => {
    const task = {
      status: "IN_PROGRESS",
      startedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("2h");
  });

  it("returns just duration (cycle time) for completed tasks", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-15T10:00:00Z",
      completedAt: "2024-01-15T11:30:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("1h 30m");
  });

  it("returns just duration for abandoned tasks", () => {
    const task = {
      status: "ABANDONED",
      startedAt: "2024-01-15T10:00:00Z",
      abandonedAt: "2024-01-15T10:45:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("45m");
  });

  it("returns null for in-progress tasks without startedAt", () => {
    expect(getTaskTimingMessage({ status: "IN_PROGRESS" })).toBeNull();
  });

  it("returns null for completed tasks without required timestamps", () => {
    expect(getTaskTimingMessage({ status: "COMPLETED" })).toBeNull();
    expect(
      getTaskTimingMessage({ status: "COMPLETED", startedAt: "2024-01-15T10:00:00Z" })
    ).toBeNull();
  });

  it("returns duration for PR_REVIEW tasks based on submittedForReviewAt", () => {
    const task = {
      status: "PR_REVIEW",
      submittedForReviewAt: "2024-01-15T11:00:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("1h");
  });

  describe("detailed variant", () => {
    it("returns 'Backlog: X' for backlog tasks", () => {
      const task = { status: "BACKLOG", createdAt: "2024-01-15T10:00:00Z" };
      expect(getTaskTimingMessage(task, "detailed")).toBe("Backlog: 2h");
    });

    it("returns 'Ready: X' for ready tasks", () => {
      const task = { status: "READY", createdAt: "2024-01-15T10:00:00Z" };
      expect(getTaskTimingMessage(task, "detailed")).toBe("Ready: 2h");
    });

    it("returns 'In progress: X' for in-progress tasks", () => {
      const task = { status: "IN_PROGRESS", startedAt: "2024-01-15T10:00:00Z" };
      expect(getTaskTimingMessage(task, "detailed")).toBe("In progress: 2h");
    });

    it("returns 'In review: X' for PR_REVIEW tasks", () => {
      const task = { status: "PR_REVIEW", submittedForReviewAt: "2024-01-15T11:00:00Z" };
      expect(getTaskTimingMessage(task, "detailed")).toBe("In review: 1h");
    });

    it("returns 'Completed: X' for completed tasks", () => {
      const task = {
        status: "COMPLETED",
        startedAt: "2024-01-15T10:00:00Z",
        completedAt: "2024-01-15T11:30:00Z",
      };
      expect(getTaskTimingMessage(task, "detailed")).toBe("Completed: 1h 30m");
    });

    it("returns 'Abandoned: X' for abandoned tasks", () => {
      const task = {
        status: "ABANDONED",
        startedAt: "2024-01-15T10:00:00Z",
        abandonedAt: "2024-01-15T10:45:00Z",
      };
      expect(getTaskTimingMessage(task, "detailed")).toBe("Abandoned: 45m");
    });
  });
});

describe("getTimeInCurrentStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns time since creation for BACKLOG tasks", () => {
    const task = {
      status: "BACKLOG",
      createdAt: "2024-01-15T10:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBe(7200000); // 2 hours
  });

  it("returns time since creation for READY tasks", () => {
    const task = {
      status: "READY",
      createdAt: "2024-01-14T12:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBe(86400000); // 1 day
  });

  it("returns time since started for IN_PROGRESS tasks", () => {
    const task = {
      status: "IN_PROGRESS",
      startedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBe(7200000); // 2 hours
  });

  it("returns time since submitted for PR_REVIEW tasks", () => {
    const task = {
      status: "PR_REVIEW",
      submittedForReviewAt: "2024-01-15T11:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBe(3600000); // 1 hour
  });

  it("returns null for COMPLETED tasks", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-15T10:00:00Z",
      completedAt: "2024-01-15T11:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBeNull();
  });

  it("returns null for ABANDONED tasks", () => {
    const task = {
      status: "ABANDONED",
      startedAt: "2024-01-15T10:00:00Z",
      abandonedAt: "2024-01-15T11:00:00Z",
    };
    expect(getTimeInCurrentStatus(task)).toBeNull();
  });

  it("returns null when required timestamp is missing", () => {
    expect(getTimeInCurrentStatus({ status: "BACKLOG" })).toBeNull();
    expect(getTimeInCurrentStatus({ status: "IN_PROGRESS" })).toBeNull();
    expect(getTimeInCurrentStatus({ status: "PR_REVIEW" })).toBeNull();
  });
});

describe("getTaskAgeColorClass", () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for fresh tasks (less than 1 day)", () => {
    const task = {
      status: "BACKLOG",
      createdAt: "2024-01-15T10:00:00Z", // 2 hours ago
    };
    expect(getTaskAgeColorClass(task)).toBeUndefined();
  });

  it("returns amber for tasks 1-2 days old", () => {
    const task = {
      status: "BACKLOG",
      createdAt: new Date(Date.now() - ONE_DAY_MS - 3600000).toISOString(), // 1 day + 1 hour ago
    };
    expect(getTaskAgeColorClass(task)).toBe("text-amber-600");
  });

  it("returns orange for tasks 2-3 days old", () => {
    const task = {
      status: "BACKLOG",
      createdAt: new Date(Date.now() - 2 * ONE_DAY_MS - 3600000).toISOString(), // 2 days + 1 hour ago
    };
    expect(getTaskAgeColorClass(task)).toBe("text-orange-600");
  });

  it("returns red for tasks 3+ days old", () => {
    const task = {
      status: "BACKLOG",
      createdAt: new Date(Date.now() - 3 * ONE_DAY_MS - 3600000).toISOString(), // 3 days + 1 hour ago
    };
    expect(getTaskAgeColorClass(task)).toBe("text-red-600");
  });

  it("returns undefined for COMPLETED tasks", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-10T10:00:00Z",
      completedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskAgeColorClass(task)).toBeUndefined();
  });

  it("returns undefined for ABANDONED tasks", () => {
    const task = {
      status: "ABANDONED",
      startedAt: "2024-01-10T10:00:00Z",
      abandonedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskAgeColorClass(task)).toBeUndefined();
  });

  it("uses startedAt for IN_PROGRESS tasks", () => {
    const task = {
      status: "IN_PROGRESS",
      startedAt: new Date(Date.now() - 2 * ONE_DAY_MS - 3600000).toISOString(), // 2 days + 1 hour ago
    };
    expect(getTaskAgeColorClass(task)).toBe("text-orange-600");
  });

  it("uses submittedForReviewAt for PR_REVIEW tasks", () => {
    const task = {
      status: "PR_REVIEW",
      submittedForReviewAt: new Date(Date.now() - 3 * ONE_DAY_MS - 3600000).toISOString(), // 3 days + 1 hour ago
    };
    expect(getTaskAgeColorClass(task)).toBe("text-red-600");
  });
});

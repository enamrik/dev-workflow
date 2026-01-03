import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatDuration,
  getTaskDuration,
  getTaskTimingMessage,
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

  it("returns null for backlog tasks", () => {
    expect(getTaskTimingMessage({ status: "BACKLOG" })).toBeNull();
  });

  it("returns 'Started X ago' for in-progress tasks", () => {
    const task = {
      status: "IN_PROGRESS",
      startedAt: "2024-01-15T10:00:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("Started 2h ago");
  });

  it("returns 'Completed in X' for completed tasks", () => {
    const task = {
      status: "COMPLETED",
      startedAt: "2024-01-15T10:00:00Z",
      completedAt: "2024-01-15T11:30:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("Completed in 1h 30m");
  });

  it("returns 'Abandoned after X' for abandoned tasks", () => {
    const task = {
      status: "ABANDONED",
      startedAt: "2024-01-15T10:00:00Z",
      abandonedAt: "2024-01-15T10:45:00Z",
    };
    expect(getTaskTimingMessage(task)).toBe("Abandoned after 45m");
  });

  it("returns null for tasks without startedAt", () => {
    expect(getTaskTimingMessage({ status: "IN_PROGRESS" })).toBeNull();
    expect(getTaskTimingMessage({ status: "COMPLETED" })).toBeNull();
  });
});

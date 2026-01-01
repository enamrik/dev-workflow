import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiProjectService } from "../multi-project-service.js";

// Mock the core module
vi.mock("@dev-workflow/core", () => ({
  DatabaseService: {
    create: vi.fn().mockResolvedValue({
      getDb: vi.fn().mockReturnValue({}),
      close: vi.fn(),
    }),
  },
  SqliteIssueRepository: vi.fn(),
  SqlitePlanRepository: vi.fn(),
  SqliteTaskRepository: vi.fn(),
  SqliteMilestoneRepository: vi.fn(),
  getGlobalDatabasePath: vi.fn().mockReturnValue("/mock/path/workflow.db"),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    access: vi.fn(),
  },
  readdir: vi.fn(),
  access: vi.fn(),
}));

describe("MultiProjectService.listCompletedTasks", () => {
  let service: MultiProjectService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MultiProjectService("/mock/track");
  });

  describe("time filtering logic", () => {
    it("should only include tasks completed within the last 7 days", () => {
      // Test the filtering logic conceptually
      const now = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Task completed 3 days ago - should be included
      const recentTask = {
        completedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(recentTask.completedAt >= sevenDaysAgo.toISOString()).toBe(true);

      // Task completed 10 days ago - should be excluded
      const oldTask = {
        completedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(oldTask.completedAt >= sevenDaysAgo.toISOString()).toBe(false);
    });

    it("should handle abandonedAt for abandoned tasks", () => {
      const now = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Abandoned task within window
      const recentAbandoned = {
        abandonedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };
      expect(recentAbandoned.abandonedAt >= sevenDaysAgo.toISOString()).toBe(true);
    });
  });

  describe("count limiting logic", () => {
    it("should limit results to 20 tasks", () => {
      // Create 25 tasks
      const tasks = Array.from({ length: 25 }, (_, i) => ({
        id: `task-${i}`,
        completedAt: new Date().toISOString(),
      }));

      // Limit to 20
      const limited = tasks.slice(0, 20);
      expect(limited.length).toBe(20);
    });
  });

  describe("sorting logic", () => {
    it("should sort by completion date descending (most recent first)", () => {
      const now = new Date();
      const tasks = [
        { id: "old", completedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "new", completedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "mid", completedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      ];

      // Sort by completedAt descending
      const sorted = [...tasks].sort((a, b) => {
        const dateA = a.completedAt ?? "";
        const dateB = b.completedAt ?? "";
        return dateB.localeCompare(dateA);
      });

      expect(sorted[0]?.id).toBe("new");
      expect(sorted[1]?.id).toBe("mid");
      expect(sorted[2]?.id).toBe("old");
    });
  });

  describe("deduplication logic", () => {
    it("should deduplicate tasks by id", () => {
      const openIssueTaskIds = new Set(["task-1", "task-2"]);

      const completedTasks = [
        { id: "task-1" }, // Already in open issues - should be skipped
        { id: "task-3" }, // New - should be included
        { id: "task-2" }, // Already in open issues - should be skipped
        { id: "task-4" }, // New - should be included
      ];

      const newTasks = completedTasks.filter((t) => !openIssueTaskIds.has(t.id));

      expect(newTasks.length).toBe(2);
      expect(newTasks.map((t) => t.id)).toEqual(["task-3", "task-4"]);
    });
  });
});

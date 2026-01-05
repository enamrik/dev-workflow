import { describe, it, expect } from "vitest";
import { computeMilestoneStatus, type MilestoneIssueStats } from "../milestone.js";

describe("computeMilestoneStatus", () => {
  // Helper to create issue stats
  const stats = (
    totalIssues: number,
    closedIssues: number,
    openOrInProgressIssues: number
  ): MilestoneIssueStats => ({
    totalIssues,
    closedIssues,
    openOrInProgressIssues,
  });

  describe("COMPLETED status", () => {
    it("should return COMPLETED when stored status is COMPLETED regardless of issue states", () => {
      // Even with no issues
      expect(computeMilestoneStatus("COMPLETED", stats(0, 0, 0), "2025-12-31", "2025-01-01")).toBe(
        "COMPLETED"
      );

      // Even with open issues
      expect(computeMilestoneStatus("COMPLETED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "COMPLETED"
      );

      // Even when past end date
      expect(computeMilestoneStatus("COMPLETED", stats(5, 2, 3), "2024-12-31", "2025-01-01")).toBe(
        "COMPLETED"
      );
    });

    it("should preserve COMPLETED even when all issues are closed", () => {
      expect(computeMilestoneStatus("COMPLETED", stats(5, 5, 0), "2025-12-31", "2025-01-01")).toBe(
        "COMPLETED"
      );
    });
  });

  describe("DELAYED status", () => {
    it("should return DELAYED when past endDate and not all issues are closed", () => {
      // Past end date with some open issues
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2024-12-31", "2025-01-01")).toBe(
        "DELAYED"
      );

      // Past end date with no issues closed
      expect(computeMilestoneStatus("PLANNED", stats(5, 0, 5), "2024-12-31", "2025-01-01")).toBe(
        "DELAYED"
      );

      // Past end date with some issues closed but not all
      expect(
        computeMilestoneStatus("IN_PROGRESS", stats(10, 8, 2), "2024-06-30", "2025-01-01")
      ).toBe("DELAYED");
    });

    it("should NOT return DELAYED when all issues are closed even if past endDate", () => {
      // Past end date but all issues closed - milestone completed naturally
      expect(computeMilestoneStatus("PLANNED", stats(5, 5, 0), "2024-12-31", "2025-01-01")).toBe(
        "PLANNED"
      );
    });

    it("should NOT return DELAYED when endDate is today or in future", () => {
      // End date is today
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-01-01", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );

      // End date is in future
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );
    });

    it("should return DELAYED for empty milestone past endDate", () => {
      // No issues assigned but past end date - still delayed since milestone not complete
      expect(computeMilestoneStatus("PLANNED", stats(0, 0, 0), "2024-12-31", "2025-01-01")).toBe(
        "DELAYED"
      );
    });
  });

  describe("IN_PROGRESS status", () => {
    it("should return IN_PROGRESS when at least one issue is OPEN or IN_PROGRESS", () => {
      // Some issues open
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );

      // Just one issue open
      expect(computeMilestoneStatus("PLANNED", stats(5, 4, 1), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );

      // All issues open
      expect(computeMilestoneStatus("PLANNED", stats(5, 0, 5), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );
    });

    it("should return IN_PROGRESS regardless of stored status (except COMPLETED)", () => {
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );

      expect(
        computeMilestoneStatus("IN_PROGRESS", stats(5, 2, 3), "2025-12-31", "2025-01-01")
      ).toBe("IN_PROGRESS");

      expect(computeMilestoneStatus("DELAYED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );
    });
  });

  describe("PLANNED status", () => {
    it("should return PLANNED when no issues are assigned", () => {
      expect(computeMilestoneStatus("PLANNED", stats(0, 0, 0), "2025-12-31", "2025-01-01")).toBe(
        "PLANNED"
      );
    });

    it("should return PLANNED when all issues are in PLANNED status (none open/in-progress)", () => {
      // 5 issues assigned, none open/in-progress, none closed (all PLANNED)
      expect(computeMilestoneStatus("PLANNED", stats(5, 0, 0), "2025-12-31", "2025-01-01")).toBe(
        "PLANNED"
      );
    });

    it("should return PLANNED when all issues are closed (milestone naturally complete but not signed off)", () => {
      // All issues closed - awaiting explicit COMPLETED sign-off
      expect(computeMilestoneStatus("PLANNED", stats(5, 5, 0), "2025-12-31", "2025-01-01")).toBe(
        "PLANNED"
      );

      // This matches the requirement that COMPLETED requires manual sign-off
      expect(
        computeMilestoneStatus("IN_PROGRESS", stats(10, 10, 0), "2025-12-31", "2025-01-01")
      ).toBe("PLANNED");
    });
  });

  describe("priority order", () => {
    it("should respect priority: COMPLETED > DELAYED > IN_PROGRESS > PLANNED", () => {
      // COMPLETED always wins
      expect(computeMilestoneStatus("COMPLETED", stats(5, 2, 3), "2024-12-31", "2025-01-01")).toBe(
        "COMPLETED"
      );

      // DELAYED wins over IN_PROGRESS when past endDate
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2024-12-31", "2025-01-01")).toBe(
        "DELAYED"
      );

      // IN_PROGRESS wins over PLANNED when issues are active (before endDate)
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-12-31", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );
    });
  });

  describe("edge cases", () => {
    it("should handle today being exactly on endDate", () => {
      // On the end date, not past it - should be IN_PROGRESS
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2025-01-01", "2025-01-01")).toBe(
        "IN_PROGRESS"
      );
    });

    it("should handle day after endDate", () => {
      // One day after end date - DELAYED
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2024-12-31", "2025-01-01")).toBe(
        "DELAYED"
      );
    });

    it("should use default today when not provided", () => {
      // Without explicit today, should use current date
      // Future date milestone with active issues should be IN_PROGRESS
      expect(computeMilestoneStatus("PLANNED", stats(5, 2, 3), "2099-12-31")).toBe("IN_PROGRESS");
    });

    it("should handle large numbers", () => {
      expect(
        computeMilestoneStatus("PLANNED", stats(1000, 500, 500), "2025-12-31", "2025-01-01")
      ).toBe("IN_PROGRESS");

      expect(
        computeMilestoneStatus("PLANNED", stats(1000, 1000, 0), "2024-12-31", "2025-01-01")
      ).toBe("PLANNED");
    });
  });
});

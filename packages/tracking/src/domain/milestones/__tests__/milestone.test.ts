import { describe, it, expect } from "vitest";
import { Milestone } from "../milestone.js";
import type { MilestoneIssueStats } from "../milestone.js";

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return Milestone.from({
    id: "test-id",
    number: 1,
    title: "Test milestone",
    description: "Test description",
    startDate: "2024-01-01",
    endDate: "2024-03-31",
    status: "PLANNED",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });
}

const emptyStats: MilestoneIssueStats = {
  totalIssues: 0,
  closedIssues: 0,
  openOrInProgressIssues: 0,
};

describe("Milestone", () => {
  // ===========================================================================
  // Milestone.from()
  // ===========================================================================

  describe("from()", () => {
    it("should create a Milestone instance with all fields", () => {
      const milestone = makeMilestone();

      expect(milestone.id).toBe("test-id");
      expect(milestone.number).toBe(1);
      expect(milestone.title).toBe("Test milestone");
      expect(milestone.description).toBe("Test description");
      expect(milestone.startDate).toBe("2024-01-01");
      expect(milestone.endDate).toBe("2024-03-31");
      expect(milestone.status).toBe("PLANNED");
      expect(milestone.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(milestone.updatedAt).toBe("2024-01-01T00:00:00Z");
    });

    it("should be an instanceof Milestone", () => {
      const milestone = makeMilestone();
      expect(milestone).toBeInstanceOf(Milestone);
    });

    it("should produce clean JSON with no methods", () => {
      const milestone = makeMilestone();
      const json = JSON.parse(JSON.stringify(milestone));

      expect(json).toEqual({
        id: "test-id",
        number: 1,
        title: "Test milestone",
        description: "Test description",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
        status: "PLANNED",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      });

      // Verify no function properties leaked into JSON
      for (const value of Object.values(json)) {
        expect(typeof value).not.toBe("function");
      }
    });
  });

  // ===========================================================================
  // Milestone.computeStatus()
  // ===========================================================================

  describe("computeStatus()", () => {
    it("should return COMPLETED when stored status is COMPLETED", () => {
      const result = Milestone.computeStatus("COMPLETED", emptyStats, "2024-03-31", "2024-06-01");
      expect(result).toBe("COMPLETED");
    });

    it("should return COMPLETED even when past endDate with open issues", () => {
      const stats: MilestoneIssueStats = {
        totalIssues: 5,
        closedIssues: 2,
        openOrInProgressIssues: 3,
      };
      const result = Milestone.computeStatus("COMPLETED", stats, "2024-03-31", "2024-06-01");
      expect(result).toBe("COMPLETED");
    });

    it("should return DELAYED when past endDate and not all issues closed", () => {
      const stats: MilestoneIssueStats = {
        totalIssues: 5,
        closedIssues: 3,
        openOrInProgressIssues: 1,
      };
      const result = Milestone.computeStatus("PLANNED", stats, "2024-03-31", "2024-06-01");
      expect(result).toBe("DELAYED");
    });

    it("should return DELAYED when past endDate and no issues at all", () => {
      const result = Milestone.computeStatus("PLANNED", emptyStats, "2024-03-31", "2024-06-01");
      expect(result).toBe("DELAYED");
    });

    it("should not return DELAYED when all issues are closed", () => {
      const stats: MilestoneIssueStats = {
        totalIssues: 3,
        closedIssues: 3,
        openOrInProgressIssues: 0,
      };
      const result = Milestone.computeStatus("PLANNED", stats, "2024-03-31", "2024-06-01");
      // All closed + past end date = PLANNED (not delayed)
      expect(result).toBe("PLANNED");
    });

    it("should return IN_PROGRESS when there are active issues", () => {
      const stats: MilestoneIssueStats = {
        totalIssues: 5,
        closedIssues: 1,
        openOrInProgressIssues: 3,
      };
      const result = Milestone.computeStatus("PLANNED", stats, "2024-12-31", "2024-06-01");
      expect(result).toBe("IN_PROGRESS");
    });

    it("should return PLANNED when no active issues and not past endDate", () => {
      const result = Milestone.computeStatus("PLANNED", emptyStats, "2024-12-31", "2024-06-01");
      expect(result).toBe("PLANNED");
    });

    it("should return PLANNED when all issues are in planning state", () => {
      const stats: MilestoneIssueStats = {
        totalIssues: 3,
        closedIssues: 0,
        openOrInProgressIssues: 0,
      };
      const result = Milestone.computeStatus("PLANNED", stats, "2024-12-31", "2024-06-01");
      expect(result).toBe("PLANNED");
    });
  });

  // ===========================================================================
  // Milestone.validateDate()
  // ===========================================================================

  describe("validateDate()", () => {
    it("should accept valid YYYY-MM-DD format", () => {
      const result = Milestone.validateDate("2024-03-15", "startDate");
      expect(result).toEqual({ valid: true });
    });

    it("should reject invalid format (no dashes)", () => {
      const result = Milestone.validateDate("20240315", "startDate");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("startDate must be in YYYY-MM-DD format");
    });

    it("should reject invalid format (wrong separator)", () => {
      const result = Milestone.validateDate("2024/03/15", "endDate");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("endDate must be in YYYY-MM-DD format");
    });

    it("should reject empty string", () => {
      const result = Milestone.validateDate("", "startDate");
      expect(result.valid).toBe(false);
    });

    it("should use the provided fieldName in the error reason", () => {
      const result = Milestone.validateDate("bad-date", "myField");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("myField");
    });
  });

  // ===========================================================================
  // Milestone.validateDateRange()
  // ===========================================================================

  describe("validateDateRange()", () => {
    it("should accept when startDate is before endDate", () => {
      const result = Milestone.validateDateRange("2024-01-01", "2024-03-31");
      expect(result).toEqual({ valid: true });
    });

    it("should accept when startDate equals endDate", () => {
      const result = Milestone.validateDateRange("2024-01-01", "2024-01-01");
      expect(result).toEqual({ valid: true });
    });

    it("should reject when startDate is after endDate", () => {
      const result = Milestone.validateDateRange("2024-06-01", "2024-01-01");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("startDate must be before or equal to endDate");
    });
  });

  // ===========================================================================
  // Milestone.canSetStatus()
  // ===========================================================================

  describe("canSetStatus()", () => {
    it("should allow setting status to COMPLETED", () => {
      const result = Milestone.canSetStatus("COMPLETED");
      expect(result).toEqual({ valid: true });
    });

    it("should reject setting status to PLANNED", () => {
      const result = Milestone.canSetStatus("PLANNED");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        "Cannot set status to PLANNED. Only COMPLETED can be set manually."
      );
    });

    it("should reject setting status to IN_PROGRESS", () => {
      const result = Milestone.canSetStatus("IN_PROGRESS");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("IN_PROGRESS");
    });

    it("should reject setting status to DELAYED", () => {
      const result = Milestone.canSetStatus("DELAYED");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("DELAYED");
    });
  });
});

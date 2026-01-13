/**
 * Milestone Tools Integration Tests
 *
 * Tests MCP tool handlers for milestone operations with real database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createClientForProject, createTestIssue, createNoOpProvider } from "../helpers.js";
import { MilestoneService, IssueService, TaskService, type DbClient } from "@dev-workflow/core";
import {
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
  type MilestoneToolContext,
} from "../../tools/milestone-tools.js";
import {
  CreateMilestoneSchema,
  GetMilestoneSchema,
  ListMilestonesSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneSchema,
} from "../../tools/schemas.js";

/** Test project ID */
const TEST_PROJECT_ID = "test-project-milestone";

describe("Milestone Tools", () => {
  let testDb: TestDatabase;
  let ctx: MilestoneToolContext;
  let client: DbClient;

  beforeEach(async () => {
    testDb = createTestDatabase();

    // Create project first
    const project = await testDb.source.projects.create({
      gitRootHash: TEST_PROJECT_ID,
      name: "Test Project",
    });

    // Create client scoped to project
    client = createClientForProject(testDb, project.id);

    // Create services with DbClient
    const noOpProvider = createNoOpProvider();
    const taskService = new TaskService(client, noOpProvider, null);
    const issueService = new IssueService(client, taskService, noOpProvider);
    const milestoneService = new MilestoneService(client);

    ctx = {
      milestoneService,
      issueService,
      projectName: "test-project",
    };
  });

  describe("handleAssignIssueToMilestone", () => {
    it("should assign an issue to a milestone", () => {
      // Create an issue
      const issue = createTestIssue(client.issues, {
        title: "Test Issue",
      });

      // Create a milestone
      const milestone = client.milestones.create({
        title: "MVP",
        description: "First release",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "PLANNED",
      });

      // Assign issue to milestone
      const result = handleAssignIssueToMilestone(ctx, {
        issueNumber: issue.number,
        milestoneNumber: milestone.number,
      });

      expect(result.content[0].type).toBe("text");
      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.message).toContain("Assigned issue");

      // Verify the issue now has the milestoneId
      const updatedIssue = client.issues.findByNumber(issue.number);
      expect(updatedIssue?.milestoneId).toBe(milestone.id);
    });

    it("should return error if issue not found", () => {
      // Create a milestone
      const milestone = client.milestones.create({
        title: "MVP",
        description: "First release",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "PLANNED",
      });

      const result = handleAssignIssueToMilestone(ctx, {
        issueNumber: 999,
        milestoneNumber: milestone.number,
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.success).toBe(false);
      expect(response.error).toContain("Issue #999 not found");
    });

    it("should return error if milestone not found", () => {
      const issue = createTestIssue(client.issues);

      const result = handleAssignIssueToMilestone(ctx, {
        issueNumber: issue.number,
        milestoneNumber: 999,
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.success).toBe(false);
      expect(response.error).toContain("Milestone M999 not found");
    });
  });

  describe("handleRemoveIssueFromMilestone", () => {
    it("should remove an issue from its milestone", () => {
      // Create a milestone
      const milestone = client.milestones.create({
        title: "MVP",
        description: "First release",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "PLANNED",
      });

      // Create an issue and assign it to the milestone
      const issue = createTestIssue(client.issues, {
        title: "Test Issue",
      });
      client.issues.update(issue.id, { milestoneId: milestone.id });

      // Verify it's assigned
      const assignedIssue = client.issues.findByNumber(issue.number);
      expect(assignedIssue?.milestoneId).toBe(milestone.id);

      // Remove from milestone
      const result = handleRemoveIssueFromMilestone(ctx, {
        issueNumber: issue.number,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.message).toContain("Removed issue");

      // Verify the issue no longer has a milestoneId
      const updatedIssue = client.issues.findByNumber(issue.number);
      expect(updatedIssue?.milestoneId).toBeUndefined();
    });

    it("should return error if issue not found", () => {
      const result = handleRemoveIssueFromMilestone(ctx, {
        issueNumber: 999,
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.success).toBe(false);
      expect(response.error).toContain("Issue #999 not found");
    });

    it("should return error if issue is not assigned to any milestone", () => {
      // Create an issue without a milestone
      const issue = createTestIssue(client.issues, {
        title: "Test Issue",
      });

      const result = handleRemoveIssueFromMilestone(ctx, {
        issueNumber: issue.number,
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.success).toBe(false);
      expect(response.error).toContain("not assigned to any milestone");
    });
  });
});

/**
 * Schema Validation Tests for Milestone Tools
 */
describe("Milestone Tool Schema Validation", () => {
  describe("CreateMilestoneSchema", () => {
    it("should accept valid milestone", () => {
      const input = {
        title: "Q1 Release",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
        description: "First quarter release",
      };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept without optional description", () => {
      const input = {
        title: "Q1 Release",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing title", () => {
      const input = {
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing dates", () => {
      const input = { title: "Q1 Release" };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("GetMilestoneSchema", () => {
    it("should accept milestoneNumber", () => {
      const result = GetMilestoneSchema.safeParse({ milestoneNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept id", () => {
      const result = GetMilestoneSchema.safeParse({ id: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = GetMilestoneSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("ListMilestonesSchema", () => {
    it("should accept status filter", () => {
      const result = ListMilestonesSchema.safeParse({ status: "IN_PROGRESS" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = ListMilestonesSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject invalid status", () => {
      const result = ListMilestonesSchema.safeParse({ status: "INVALID" });
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateMilestoneSchema", () => {
    it("should accept valid updates", () => {
      const input = {
        milestoneNumber: 1,
        updates: { title: "Updated Title" },
      };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept all valid update fields", () => {
      const input = {
        milestoneNumber: 1,
        updates: {
          title: "Updated Title",
          description: "Updated description",
          startDate: "2024-02-01",
          endDate: "2024-04-30",
          status: "COMPLETED",
        },
      };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing milestoneNumber", () => {
      const input = { updates: { title: "Updated" } };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing updates", () => {
      const input = { milestoneNumber: 1 };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DeleteMilestoneSchema", () => {
    it("should accept milestoneNumber", () => {
      const result = DeleteMilestoneSchema.safeParse({ milestoneNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing milestoneNumber", () => {
      const result = DeleteMilestoneSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("AssignIssueToMilestoneSchema", () => {
    it("should accept valid input", () => {
      const input = { issueNumber: 1, milestoneNumber: 2 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const input = { milestoneNumber: 2 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing milestoneNumber", () => {
      const input = { issueNumber: 1 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("RemoveIssueFromMilestoneSchema", () => {
    it("should accept issueNumber", () => {
      const result = RemoveIssueFromMilestoneSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const result = RemoveIssueFromMilestoneSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

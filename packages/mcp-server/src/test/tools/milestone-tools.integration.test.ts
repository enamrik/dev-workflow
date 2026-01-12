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

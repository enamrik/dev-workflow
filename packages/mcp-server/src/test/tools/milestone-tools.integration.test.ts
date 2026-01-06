/**
 * Milestone Tools Integration Tests
 *
 * Tests MCP tool handlers for milestone operations with real database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue } from "../helpers.js";
import { SqliteMilestoneRepository, SqliteProjectRepository } from "@dev-workflow/core";
import {
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
  type MilestoneToolContext,
} from "../../tools/milestone-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/** Test project ID */
const TEST_PROJECT_ID = "test-project-milestone";

describe("Milestone Tools", () => {
  let testDb: TestDatabase;
  let ctx: MilestoneToolContext;
  let projectId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    const db = testDb.db as DbType;

    // Create project first
    const projectRepository = new SqliteProjectRepository(db);
    const project = projectRepository.create({
      gitRootHash: TEST_PROJECT_ID,
      gitRoot: "/test/repo",
      name: "Test Project",
    });
    projectId = project.id;

    // Create repositories
    const repos = createRepositories(testDb.db, projectId);
    const milestoneRepository = new SqliteMilestoneRepository(db, projectId);

    ctx = {
      milestoneRepository,
      issueRepository: repos.issueRepository,
      projectName: "test-project",
    };
  });

  describe("handleAssignIssueToMilestone", () => {
    it("should assign an issue to a milestone", () => {
      // Create an issue
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Issue",
      });

      // Create a milestone
      const milestone = ctx.milestoneRepository.create({
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
      const updatedIssue = ctx.issueRepository.findByNumber(issue.number);
      expect(updatedIssue?.milestoneId).toBe(milestone.id);
    });

    it("should return error if issue not found", () => {
      // Create a milestone
      const milestone = ctx.milestoneRepository.create({
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
      const issue = createTestIssue(ctx.issueRepository);

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
      const milestone = ctx.milestoneRepository.create({
        title: "MVP",
        description: "First release",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "PLANNED",
      });

      // Create an issue and assign it to the milestone
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Issue",
      });
      ctx.issueRepository.update(issue.id, { milestoneId: milestone.id });

      // Verify it's assigned
      const assignedIssue = ctx.issueRepository.findByNumber(issue.number);
      expect(assignedIssue?.milestoneId).toBe(milestone.id);

      // Remove from milestone
      const result = handleRemoveIssueFromMilestone(ctx, {
        issueNumber: issue.number,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse((result.content[0] as { text: string }).text);
      expect(response.message).toContain("Removed issue");

      // Verify the issue no longer has a milestoneId
      const updatedIssue = ctx.issueRepository.findByNumber(issue.number);
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
      const issue = createTestIssue(ctx.issueRepository, {
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

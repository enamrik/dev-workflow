/**
 * Merge Tools Integration Tests
 *
 * Tests the merge_issues MCP tool with real database operations.
 * Uses in-memory SQLite for isolation and mocked external dependencies.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../helpers.js";
import { VersioningService, MockGitHubCLI, SqliteProjectRepository } from "@dev-workflow/core";
import { handleMergeIssues, type MergeToolContext } from "../../tools/merge-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/** Test project ID */
const TEST_PROJECT_ID = "test-project-merge-integration";

/**
 * Create a MergeToolContext for testing
 */
function createMergeToolContext(testDb: TestDatabase): {
  ctx: MergeToolContext;
  projectId: string;
} {
  const db = testDb.db as DbType;

  // Create project first to get the generated ID
  const projectRepository = new SqliteProjectRepository(db);
  const project = projectRepository.create({
    gitRootHash: TEST_PROJECT_ID,
    name: "Test Project",
  });

  // Use project's actual ID for repositories
  const repos = createRepositories(testDb.db, project.id);

  // Create versioning service
  const versioningService = new VersioningService(
    repos.issueRepository,
    repos.snapshotRepository,
    repos.planRepository,
    repos.taskRepository
  );

  // Mock GitHub CLI
  const mockGitHubCLI = new MockGitHubCLI();

  return {
    ctx: {
      issueRepository: repos.issueRepository,
      planRepository: repos.planRepository,
      taskRepository: repos.taskRepository,
      projectRepository,
      versioningService,
      projectId: project.id,
      githubCLI: mockGitHubCLI,
    },
    projectId: project.id,
  };
}

describe("Merge Tools Integration", () => {
  let testDb: TestDatabase;
  let ctx: MergeToolContext;

  beforeEach(() => {
    testDb = createTestDatabase();
    const result = createMergeToolContext(testDb);
    ctx = result.ctx;
  });

  describe("handleMergeIssues", () => {
    describe("create_new mode", () => {
      it("should create a new issue from two source issues", async () => {
        // Create two issues with plans and tasks
        const issue1 = createTestIssue(ctx.issueRepository, {
          title: "Feature A",
          description: "Description for feature A",
        });
        const plan1 = createTestPlan(ctx.planRepository, issue1.id);
        createTestTask(ctx.taskRepository, plan1.id, { title: "Task A1" });
        createTestTask(ctx.taskRepository, plan1.id, { title: "Task A2" });

        const issue2 = createTestIssue(ctx.issueRepository, {
          title: "Feature B",
          description: "Description for feature B",
        });
        const plan2 = createTestPlan(ctx.planRepository, issue2.id);
        createTestTask(ctx.taskRepository, plan2.id, { title: "Task B1" });

        // Merge in create_new mode
        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue1.number,
          targetIssueNumber: issue2.number,
          mode: "create_new",
        });

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.mode).toBe("create_new");
        expect(content.mergedTaskCount).toBe(3); // 2 from issue1 + 1 from issue2
        expect(content.resultIssueNumber).toBeGreaterThan(issue2.number);

        // Verify original issues are unchanged
        const originalIssue1 = ctx.issueRepository.findById(issue1.id);
        const originalIssue2 = ctx.issueRepository.findById(issue2.id);
        expect(originalIssue1?.isDeleted).toBeFalsy();
        expect(originalIssue2?.isDeleted).toBeFalsy();
      });

      it("should use custom title and description when provided", async () => {
        const issue1 = createTestIssue(ctx.issueRepository, { title: "Issue 1" });
        const issue2 = createTestIssue(ctx.issueRepository, { title: "Issue 2" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue1.number,
          targetIssueNumber: issue2.number,
          mode: "create_new",
          newTitle: "Combined Feature",
          newDescription: "This is the merged description",
        });

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.resultIssueTitle).toBe("Combined Feature");
      });
    });

    describe("merge_into mode", () => {
      it("should fold source into target and soft-delete source", async () => {
        // Create source issue with tasks
        const sourceIssue = createTestIssue(ctx.issueRepository, {
          title: "Source Issue",
          description: "Source description",
        });
        const sourcePlan = createTestPlan(ctx.planRepository, sourceIssue.id);
        createTestTask(ctx.taskRepository, sourcePlan.id, { title: "Source Task 1" });
        createTestTask(ctx.taskRepository, sourcePlan.id, { title: "Source Task 2" });

        // Create target issue with tasks
        const targetIssue = createTestIssue(ctx.issueRepository, {
          title: "Target Issue",
          description: "Target description",
        });
        const targetPlan = createTestPlan(ctx.planRepository, targetIssue.id);
        createTestTask(ctx.taskRepository, targetPlan.id, { title: "Target Task 1" });

        // Merge source into target
        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: sourceIssue.number,
          targetIssueNumber: targetIssue.number,
          mode: "merge_into",
        });

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.mode).toBe("merge_into");
        expect(content.resultIssueNumber).toBe(targetIssue.number);
        expect(content.mergedTaskCount).toBe(3); // 1 original + 2 from source

        // Verify source is soft-deleted
        const deletedSource = ctx.issueRepository.findById(sourceIssue.id);
        expect(deletedSource?.isDeleted).toBe(true);

        // Verify target is unchanged (not deleted)
        const updatedTarget = ctx.issueRepository.findById(targetIssue.id);
        expect(updatedTarget?.isDeleted).toBeFalsy();
      });
    });

    describe("warnings", () => {
      it("should return warnings for in-progress tasks", async () => {
        // Create issue with an in-progress task
        const issue1 = createTestIssue(ctx.issueRepository, { title: "Issue 1" });
        const plan1 = createTestPlan(ctx.planRepository, issue1.id);
        createTestTask(ctx.taskRepository, plan1.id, {
          title: "In Progress Task",
          status: "IN_PROGRESS",
        });

        const issue2 = createTestIssue(ctx.issueRepository, { title: "Issue 2" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue1.number,
          targetIssueNumber: issue2.number,
          mode: "create_new",
        });

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.warnings).toBeDefined();
        expect(content.warnings.length).toBeGreaterThan(0);
        expect(content.warnings[0].type).toBe("in_progress_task");
        expect(content.warnings[0].taskTitle).toBe("In Progress Task");
      });

      it("should return warnings for PR review tasks", async () => {
        const issue1 = createTestIssue(ctx.issueRepository, { title: "Issue 1" });
        const plan1 = createTestPlan(ctx.planRepository, issue1.id);
        createTestTask(ctx.taskRepository, plan1.id, {
          title: "PR Review Task",
          status: "PR_REVIEW",
        });

        const issue2 = createTestIssue(ctx.issueRepository, { title: "Issue 2" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue1.number,
          targetIssueNumber: issue2.number,
          mode: "merge_into",
        });

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.warnings).toBeDefined();
        expect(content.warnings.some((w: { type: string }) => w.type === "pr_review_task")).toBe(
          true
        );
      });
    });

    describe("error cases", () => {
      it("should fail when trying to merge an issue with itself", async () => {
        const issue = createTestIssue(ctx.issueRepository, { title: "Self Issue" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue.number,
          targetIssueNumber: issue.number,
          mode: "merge_into",
        });

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("Cannot merge an issue with itself");
      });

      it("should fail when source issue is CLOSED", async () => {
        const closedIssue = createTestIssue(ctx.issueRepository, {
          title: "Closed Issue",
          status: "CLOSED",
        });
        const openIssue = createTestIssue(ctx.issueRepository, { title: "Open Issue" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: closedIssue.number,
          targetIssueNumber: openIssue.number,
          mode: "merge_into",
        });

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("CLOSED");
      });

      it("should fail when target issue is CLOSED", async () => {
        const openIssue = createTestIssue(ctx.issueRepository, { title: "Open Issue" });
        const closedIssue = createTestIssue(ctx.issueRepository, {
          title: "Closed Issue",
          status: "CLOSED",
        });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: openIssue.number,
          targetIssueNumber: closedIssue.number,
          mode: "merge_into",
        });

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("CLOSED");
      });

      it("should fail when source issue does not exist", async () => {
        const issue = createTestIssue(ctx.issueRepository, { title: "Existing Issue" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: 9999,
          targetIssueNumber: issue.number,
          mode: "merge_into",
        });

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("not found");
      });

      it("should fail with invalid mode", async () => {
        const issue1 = createTestIssue(ctx.issueRepository, { title: "Issue 1" });
        const issue2 = createTestIssue(ctx.issueRepository, { title: "Issue 2" });

        const result = await handleMergeIssues(ctx, {
          sourceIssueNumber: issue1.number,
          targetIssueNumber: issue2.number,
          mode: "invalid_mode" as any,
        });

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("Invalid mode");
      });
    });
  });
});

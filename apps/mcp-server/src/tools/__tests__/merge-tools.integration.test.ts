/**
 * Merge Tools Integration Tests
 *
 * Tests the merge_issues MCP tool with real database operations.
 * Uses in-memory SQLite for isolation and mocked external dependencies.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createTestIssue,
  createTestPlan,
  createTestTask,
  runMcpHandler,
} from "../../test/helpers.js";
import {
  VersioningService,
  MockGitHubCLI,
  MergeService,
  type DbClient,
} from "@dev-workflow/tracking";
import { handleMergeIssues, MergeIssuesSchema } from "../../tools/merge-tools.js";

/** Test project ID */
const TEST_PROJECT_ID = "test-project-merge-integration";

/**
 * Create a test context for merge tools
 */

async function createMergeToolContext(testDb: TestDatabase): Promise<{
  ctx: any;
  client: DbClient;
}> {
  // Create project first to get the generated ID
  const project = await Effect.runPromise(
    testDb.source.projects.create({
      gitRootHash: TEST_PROJECT_ID,
      name: "Test Project",
    })
  );

  // Create client scoped to this project
  const client = createClientForProject(testDb, project.id);

  // Create versioning service with DbClient
  const versioningService = new VersioningService(client);

  // Mock GitHub CLI
  const mockGitHubCLI = new MockGitHubCLI();

  // Create MergeService with DbSource (not DbClient)
  const mergeService = new MergeService(
    testDb.source,
    versioningService,
    project.id,
    mockGitHubCLI
  );

  return {
    ctx: {
      mergeService,
    },
    client,
  };
}

describe("Merge Tools Integration", () => {
  let testDb: TestDatabase;

  let ctx: any;
  let client: DbClient;

  beforeEach(async () => {
    testDb = createTestDatabase();
    const result = await createMergeToolContext(testDb);
    ctx = result.ctx;
    client = result.client;
  });

  describe("handleMergeIssues", () => {
    describe("create_new mode", () => {
      it("should create a new issue from two source issues", async () => {
        // Create two issues with plans and tasks
        const issue1 = await createTestIssue(client.issues, {
          title: "Feature A",
          description: "Description for feature A",
        });
        const plan1 = await createTestPlan(client.plans, issue1.id);
        await createTestTask(client.tasks, plan1.id, { title: "Task A1" });
        await createTestTask(client.tasks, plan1.id, { title: "Task A2" });

        const issue2 = await createTestIssue(client.issues, {
          title: "Feature B",
          description: "Description for feature B",
        });
        const plan2 = await createTestPlan(client.plans, issue2.id);
        await createTestTask(client.tasks, plan2.id, { title: "Task B1" });

        // Merge in create_new mode
        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue1.number,
            targetIssueNumber: issue2.number,
            mode: "create_new",
          },
          ctx
        );

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.mode).toBe("create_new");
        expect(content.mergedTaskCount).toBe(3); // 2 from issue1 + 1 from issue2
        expect(content.resultIssueNumber).toBeGreaterThan(issue2.number);

        // Verify original issues are unchanged
        const originalIssue1 = await Effect.runPromise(client.issues.findById(issue1.id));
        const originalIssue2 = await Effect.runPromise(client.issues.findById(issue2.id));
        expect(originalIssue1?.isDeleted).toBeFalsy();
        expect(originalIssue2?.isDeleted).toBeFalsy();
      });

      it("should use custom title and description when provided", async () => {
        const issue1 = await createTestIssue(client.issues, { title: "Issue 1" });
        const issue2 = await createTestIssue(client.issues, { title: "Issue 2" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue1.number,
            targetIssueNumber: issue2.number,
            mode: "create_new",
            newTitle: "Combined Feature",
            newDescription: "This is the merged description",
          },
          ctx
        );

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.resultIssueTitle).toBe("Combined Feature");
      });
    });

    describe("merge_into mode", () => {
      it("should fold source into target and soft-delete source", async () => {
        // Create source issue with tasks
        const sourceIssue = await createTestIssue(client.issues, {
          title: "Source Issue",
          description: "Source description",
        });
        const sourcePlan = await createTestPlan(client.plans, sourceIssue.id);
        await createTestTask(client.tasks, sourcePlan.id, { title: "Source Task 1" });
        await createTestTask(client.tasks, sourcePlan.id, { title: "Source Task 2" });

        // Create target issue with tasks
        const targetIssue = await createTestIssue(client.issues, {
          title: "Target Issue",
          description: "Target description",
        });
        const targetPlan = await createTestPlan(client.plans, targetIssue.id);
        await createTestTask(client.tasks, targetPlan.id, { title: "Target Task 1" });

        // Merge source into target
        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: sourceIssue.number,
            targetIssueNumber: targetIssue.number,
            mode: "merge_into",
          },
          ctx
        );

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.mode).toBe("merge_into");
        expect(content.resultIssueNumber).toBe(targetIssue.number);
        expect(content.mergedTaskCount).toBe(3); // 1 original + 2 from source

        // Verify source is soft-deleted
        // Use includeDeleted: true since findById filters out deleted issues by default
        const deletedSource = await Effect.runPromise(client.issues.findById(sourceIssue.id, true));
        expect(deletedSource?.isDeleted).toBe(true);

        // Verify target is unchanged (not deleted)
        const updatedTarget = await Effect.runPromise(client.issues.findById(targetIssue.id));
        expect(updatedTarget?.isDeleted).toBeFalsy();
      });
    });

    describe("warnings", () => {
      it("should return warnings for in-progress tasks", async () => {
        // Create issue with an in-progress task
        const issue1 = await createTestIssue(client.issues, { title: "Issue 1" });
        const plan1 = await createTestPlan(client.plans, issue1.id);
        await createTestTask(client.tasks, plan1.id, {
          title: "In Progress Task",
          status: "IN_PROGRESS",
        });

        const issue2 = await createTestIssue(client.issues, { title: "Issue 2" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue1.number,
            targetIssueNumber: issue2.number,
            mode: "create_new",
          },
          ctx
        );

        expect(result.isError).toBeUndefined();
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(true);
        expect(content.warnings).toBeDefined();
        expect(content.warnings.length).toBeGreaterThan(0);
        expect(content.warnings[0].type).toBe("in_progress_task");
        expect(content.warnings[0].taskTitle).toBe("In Progress Task");
      });

      it("should return warnings for PR review tasks", async () => {
        const issue1 = await createTestIssue(client.issues, { title: "Issue 1" });
        const plan1 = await createTestPlan(client.plans, issue1.id);
        await createTestTask(client.tasks, plan1.id, {
          title: "PR Review Task",
          status: "PR_REVIEW",
        });

        const issue2 = await createTestIssue(client.issues, { title: "Issue 2" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue1.number,
            targetIssueNumber: issue2.number,
            mode: "merge_into",
          },
          ctx
        );

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
        const issue = await createTestIssue(client.issues, { title: "Self Issue" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue.number,
            targetIssueNumber: issue.number,
            mode: "merge_into",
          },
          ctx
        );

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("Cannot merge an issue with itself");
      });

      it("should fail when source issue is CLOSED", async () => {
        const closedIssue = await createTestIssue(client.issues, {
          title: "Closed Issue",
          status: "CLOSED",
        });
        const openIssue = await createTestIssue(client.issues, { title: "Open Issue" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: closedIssue.number,
            targetIssueNumber: openIssue.number,
            mode: "merge_into",
          },
          ctx
        );

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("CLOSED");
      });

      it("should fail when target issue is CLOSED", async () => {
        const openIssue = await createTestIssue(client.issues, { title: "Open Issue" });
        const closedIssue = await createTestIssue(client.issues, {
          title: "Closed Issue",
          status: "CLOSED",
        });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: openIssue.number,
            targetIssueNumber: closedIssue.number,
            mode: "merge_into",
          },
          ctx
        );

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("CLOSED");
      });

      it("should fail when source issue does not exist", async () => {
        const issue = await createTestIssue(client.issues, { title: "Existing Issue" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: 9999,
            targetIssueNumber: issue.number,
            mode: "merge_into",
          },
          ctx
        );

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("not found");
      });

      it("should fail with invalid mode", async () => {
        const issue1 = await createTestIssue(client.issues, { title: "Issue 1" });
        const issue2 = await createTestIssue(client.issues, { title: "Issue 2" });

        const result = await runMcpHandler(
          handleMergeIssues,
          {
            sourceIssueNumber: issue1.number,
            targetIssueNumber: issue2.number,
            mode: "invalid_mode" as any,
          },
          ctx
        );

        expect(result.isError).toBe(true);
        const content = JSON.parse(result.content[0].text);
        expect(content.success).toBe(false);
        expect(content.error).toContain("Invalid enum value");
      });
    });
  });
});

/**
 * Schema Validation Tests for Merge Tools
 */
describe("Merge Tool Schema Validation", () => {
  describe("MergeIssuesSchema", () => {
    it("should accept valid create_new mode", () => {
      const input = {
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        mode: "create_new",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept valid merge_into mode", () => {
      const input = {
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        mode: "merge_into",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept optional newTitle and newDescription", () => {
      const input = {
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        mode: "create_new",
        newTitle: "Merged Issue",
        newDescription: "Combined description",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject invalid mode", () => {
      const input = {
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        mode: "invalid_mode",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing sourceIssueNumber", () => {
      const input = {
        targetIssueNumber: 2,
        mode: "merge_into",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing targetIssueNumber", () => {
      const input = {
        sourceIssueNumber: 1,
        mode: "merge_into",
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing mode", () => {
      const input = {
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
      };
      const result = MergeIssuesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
